import asyncio
import json
import json
import math
import random
import redis_lock
import threading
from asgiref.sync import async_to_sync
from channels.exceptions import StopConsumer
from channels.generic.websocket import WebsocketConsumer
from datetime import datetime
from django import db
from django.contrib.auth.models import User
from django.db import transaction, IntegrityError, OperationalError
from django.utils import timezone
from random import randint
from redis import Redis
from time import sleep

from snake.models import GamePlayed, GameState, PlayerState, PlayerInfo

############################# Configuration Global Vars #####################
#############################################################################
width = 7680 / 2
height = 3920 / 2

spongeBobColors = ['#dca27e', '#f0e48e', '#bcafb6', '#cedcdd', '#eda7af',
                   '#fdf9d3', '#a6dff2', '#c7d651', '#aad8b0', '#49bde5',
                   '#c05b74', '#2b5a7b', '#992a67', '#de4441', '#c36272',
                   '#7aa8ae', '#385ea5', '#83a968', '#c57764', '#835d6b']
foodShapes = ['circle', 'square', 'heart', 'star']

SERVER_WAKE_INTERVAL = 0.2


class GameStateConsumer(WebsocketConsumer):
    """ Accept and handle snake game state update from a particular client,
    similar to views, server side"""

    """Game state logic 
     Consumer-Client Communication (all consumers):
        - Connection [Client->Consumer]: 
        Once websocket connection is established (client/user calls connects 
        and sends "CONNECT" message), the associated consumer initiate user
        state (snake position & current moving direction) and add user to 
        current game board in database. 
        
        - User State Update [Client->Consumer]:
        The user sends its most recent direction of movement to its associated 
        consumer (via "DIRECTION" message). The consumer updates its user
        state in the database.
        
        - Game State Update [Consumer->Client]:
        Each consumer pushes the latest game board state (all snake status and 
        food positions) to its associated user.
        
        - Termination:
        The consumer is able to detect when its associated user is lost in
        the game, and will try to remove user from current game board, store 
        user stats, and close itself. 
    
    Consumer-Consumer Communication:
        - Master & slave servers design:
        At any timestamp, all present consumers will take the role as either
        MASTER (unique one) or SLAVE (numerously many) -- where whoever holds
        the shared Redis lock determines the unique MASTER. MASTER consumer 
        notifies all SLAVE consumers when it terminate (via "elect_new_master" 
        message through the channel layer) -- again, whichever consumer that 
        grabs the shared lock transitions from SALVE to MASTER.
        
        To achieve this design, on connection, every consumer is prepared to
        become the MASTER on initial creation. Each spawns a thread that is in 
        charge of global game state management. 
        However, on failing to grab the shared Redis lock, a consumer demotes 
        to SLAVE where it pauses the game state update thread. On receiving 
        the termination message from current MASTER 
        ("elect_new_master" message), the SLAVE consumer will try to grab the 
        shared Redis lock.
        The paused thread will be notified to start updating game state only 
        when the SLAVE transition to MASTER successfully. The update thread is 
        killed upon consumer termination.
    
        - Game State Management: 
        MASTER consumer locks all database tables related to player state and
        game board state and calculating the next game board state (next 
        positions for all snakes and food allocation). It then broadcasts the 
        updated game state to itself and all SLAVE consumer via the channel
        layer.
    """

    # redis parameters
    conn = Redis('127.0.0.1')
    group_name = 'snake_server_group'

    # MASTER - SLAVE role management
    gameLoopThread = None
    gameLoopThreadEvent = None
    isMaster = False
    serverCV = threading.Condition(threading.Lock())

    # performance optimization helper variables
    connected = False
    latestGameTimeStamp = None

    def connect(self):
        """Join channel layer and accept the client"""
        async_to_sync(self.channel_layer.group_add)(
            self.group_name, self.channel_name
        )

        self.accept()

        if not self.scope["user"].is_authenticated:
            self.send_error(f'You must be logged in')
            self.close()
            return

        # Write history to system log for future recovery purposes
        print('[CONNECT]', self.channel_name[-10:], 'accepted new connection',
              self.scope['user'].username)

    def disconnect(self, close_code):
        if self.connected:
            print('[TERMINATION]', self.channel_name[-10:],
                  'received disconnection', self.scope['user'].username)

            remove_snake(self.scope['user'])

            # terminate game update loop
            self.gameLoopThreadEvent.set()
            with self.serverCV:
                self.serverCV.notifyAll()
            self.gameLoopThread.join()
            if self.isMaster:
                # signal MASTER termination messages to all potential SLAVES
                for _ in range(2):
                    async_to_sync(self.channel_layer.group_send)(
                        self.group_name, {"type": "elect_new_master"})

            # resource clean up
            async_to_sync(self.channel_layer.group_discard)(
                self.group_name, self.channel_name
            )
            db.connections.close_all()
            self.connected = False

            print('[TERMINATION]', self.channel_name[-10:], "is closed",
                  self.scope['user'].username)

            raise StopConsumer()

    def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
        except:
            self.send_error('invalid JSON sent to server')
            return
        if 'TYPE' not in text_data_json or 'username' not in text_data_json:
            self.send_error('message TYPE not sent in JSON')
            return

        if text_data_json['TYPE'] == 'CONNECT':
            self.connected = True
            add_snake(self.scope['user'])
            # prepare to be MASTER consumer
            self.gameLoopThreadEvent = threading.Event()
            self.gameLoopThread = threading.Thread(
                target=self.master_update_loop)
            self.gameLoopThread.start()

        elif text_data_json['TYPE'] == 'DIRECTION':
            if 'dir' not in text_data_json or \
                    'x' not in text_data_json['dir'] \
                    or 'y' not in text_data_json['dir']:
                self.send_error('dir property not sent correctly in JSON')
                return
            if self.connected:
                dir = text_data_json['dir']
                update_direction(self.scope['user'], dir)

        else:
            self.send_error(
                f'Invalid TYPE property: "{text_data_json["TYPE"]}"')

    def master_update_loop(self):
        """MASTER game state update thread"""
        # Try to grab shared redis master lock
        masterLock = redis_lock.Lock(self.conn, name='masterConsumer',
                                     expire=10,
                                     auto_renewal=True)
        while True:
            # quit thread on consumer closing
            if self.gameLoopThreadEvent.is_set():
                if self.isMaster:
                    masterLock.release()
                return
            # tries to become MASTER
            if masterLock.acquire(blocking=False):
                self.isMaster = True
                break
            else:
                # demotes to SLAVE & wait for current MASTER termination
                with self.serverCV:
                    self.serverCV.wait()

        # Became MASTER: update & broadcast game board state
        while True:
            game_state = update_game_board()
            async_to_sync(self.channel_layer.group_send)(
                self.group_name,
                {
                    "type": "slave_propagate_update",
                    "message": game_state,
                    'timestamp': timezone.now().isoformat(),
                }
            )
            sleep(SERVER_WAKE_INTERVAL)

            if self.gameLoopThreadEvent.is_set():
                masterLock.release()
                return

    def slave_propagate_update(self, event):
        """Propagate game state received from MASTER to user, autocloses on user lo"""
        if self.connected and (self.latestGameTimeStamp is None or self.latestGameTimeStamp < datetime.fromisoformat(
                event['timestamp'])):
            self.send(
                json.dumps({'ALL_SNAKES': event['message']["snakes"],
                            'ALL_FOOD': event['message']["food"],
                            'GRID_DIMENSIONS': {'width': width,
                                                'height': height},
                            'EXTRA_INFORMATION': event['message'][
                                "extraInformation"]}))
            self.latestGameTimeStamp = datetime.fromisoformat(
                event['timestamp'])
            if self.scope['user'].username not in event['message']["snakes"]:
                self.close()
                print('[DISCONNECT]', "Auto disconnected by the server")

    def elect_new_master(self, _):
        if not self.isMaster:
            with self.serverCV:
                self.serverCV.notifyAll()

    def send_error(self, error_message):
        self.send(text_data=json.dumps({'error': error_message}))


################ Game Board Management Helper Functions #####################
#############################################################################
def init_game_board():
    """set up initial game"""
    return {
        "snakes": {},
        "food": [
            {'x': random.randint(int(width * 0.05),
                                 int(width * 0.95)),
             'y': random.randint(int(height * 0.05),
                                 int(height * 0.95)),
             'color': random.choice(spongeBobColors),
             'shape': random.choice(foodShapes)} for _ in
            range(int(width * height / (200 ** 2)))],
        "gamePlayed": {},
        "extraInformation": {},
        "newPlayer": []
    }


def update_game_board():
    """locks player states & game board state to calculate next game state"""
    for _ in range(5):
        try:
            with transaction.atomic():
                directions = PlayerState.objects.select_for_update().all()
                direction = {
                    player.username.username: json.loads(player.direction)
                    for
                    player in
                    directions}

                game = GameState.objects.select_for_update().all()
                game_state = None
                # if game is not created
                if len(game) == 0:
                    game_state = init_game_board()
                else:
                    game = game[0]
                    game_state = json.loads(game.game_state)
                    game_state = calculate_next_game_board(game_state,
                                                           direction)
                GameState.objects.update_or_create(id=1,
                                                   defaults={
                                                       'game_state': json.dumps(
                                                           game_state)})

                return game_state

        except (OperationalError, IntegrityError) as e:
            print('[RETRY]', 'Discarding game board update due to conflict',
                  e)
    return game_state


def calculate_next_game_board(game_state, direction):
    numberFoodsEaten = 0
    for user in list(game_state["snakes"].keys()).copy():
        snake = game_state["snakes"][user]
        direction_ = direction[user]
        user_obj = User.objects.get(username=user)

        next_head_x = math.floor(
            snake[0]['x'] + 30 * direction_['x'])
        next_head_y = math.floor(
            snake[0]['y'] + 30 * direction_['y'])

        if not (
                0 < next_head_x < width and 0 < next_head_y < height):
            del game_state["snakes"][user]
            del game_state["extraInformation"][user]

            sesh = game_state['gamePlayed'][user]
            if sesh["score"] >= 0:
                other_user = User.objects.all().get(
                    username="the wall :(")
                m = GamePlayed(user=user_obj)
                m.start = sesh["start"]
                m.end = timezone.now()
                m.score = sesh["score"]
                m.eaten_by = other_user
                m.others_pwned = sesh["others_pwned"]
                m.save()
                sesh["saved"] = True
                print('[SAVE]', 'Crashed into Wall, saving ...')
            continue

        # Check if snake has collided with another snake
        for otherUser in list(
                game_state["snakes"].keys()).copy():
            if user == otherUser:
                continue
            otherUserSnake = game_state["snakes"][otherUser]
            collide = False
            for otherSnakeCoordinate in otherUserSnake:
                otherX = otherSnakeCoordinate['x']
                otherY = otherSnakeCoordinate['y']
                if calculateDistance(next_head_x,
                                     next_head_y,
                                     otherX, otherY) < 30:
                    # Consider this a collision
                    del game_state["snakes"][user]
                    del game_state["extraInformation"][user]
                    collide = True
                    # Save the scores
                    sesh = game_state['gamePlayed'][user]
                    sesh_other = game_state['gamePlayed'][
                        otherUser]
                    sesh_other['others_pwned'] += 1

                    if sesh["score"] >= 0:
                        m = GamePlayed(user=user_obj)
                        m.start = sesh["start"]
                        m.end = timezone.now()
                        m.score = sesh["score"]
                        m.eaten_by = User.objects.all().get(
                            username=otherUser)
                        m.others_pwned = sesh["others_pwned"]
                        m.save()
                        print('[SAVE]', 'saving')
                        sesh["saved"] = True
                    break
            if collide:
                break

        # Check if snake has reached some food
        foodArray = game_state['food']
        currentIndex = 0
        ateFood = False
        while currentIndex < len(foodArray):
            currentFood = foodArray[currentIndex]
            if calculateDistance(next_head_x, next_head_y,
                                 currentFood['x'],
                                 currentFood['y']) < 25:
                ateFood = True
                game_state['gamePlayed'][user]["score"] += 1
                foodArray.pop(currentIndex)
                numberFoodsEaten = numberFoodsEaten + 1
                # break
            currentIndex = currentIndex + 1

        snake.insert(0, {'x': next_head_x, 'y': next_head_y})
        if not ateFood:
            snake.pop()

    for x in range(numberFoodsEaten):
        game_state['food'].append({'x': random.randint(
            int(width * 0.05), int(width * 0.95)),
            'y': random.randint(
                int(height * 0.05),
                int(height * 0.95)),
            'color': random.choice(
                spongeBobColors),
            'shape': random.choice(
                foodShapes)})
        if x > 0:
            snake.append(snake[len(snake) - 1])

    return game_state


################ User State Management Helper Functions #####################
#############################################################################
def sesh_init():
    return {
        "user": None,
        "start": timezone.now().isoformat(),
        "end": None,
        "score": 0,
        "others_pwned": 0,
        "saved": False,
    }


def add_snake(user):
    for _ in range(5):
        try:
            with transaction.atomic():
                # create a player for the user
                player, created = PlayerState.objects.update_or_create(
                    username=user,
                    defaults={
                        'direction': json.dumps({"x": 0, "y": 0, })})
                print('[INITIALIZATION]', "add snake - ",
                      player.username.username, created)

            with transaction.atomic():
                # Add user to game board
                # user = user.username
                game = GameState.objects.select_for_update().all()
                game_state = None
                if len(game) == 0:
                    game_state = init_game_board()
                else:
                    game = game[0]
                    game_state = json.loads(game.game_state)

                generate_snake(game_state, user)
                GameState.objects.update_or_create(id=1,
                                                   defaults={
                                                       'game_state': json.dumps(
                                                           game_state)})
                return
        except (OperationalError, IntegrityError) as e:
            print('RETRY', 'Discarding game board update due to conflict', e)


def generate_snake(game_state, user):
    randomStartX = random.randint(int(width * 0.05), int(width * 0.95))
    randomStartY = random.randint(int(height * 0.05), int(height * 0.95))
    game_state["snakes"][user.username] = [{'x': randomStartX,
                                            'y': randomStartY}] * 6

    game_state["extraInformation"][user.username] = {"profile_picture":
                                                         user.social_auth.get(
                                                             provider='google-oauth2').extra_data[
                                                             'picture'],
                                                     "colours": {
                                                         "outer_colour": user.player_info.outer_colour,
                                                         "inner_colour": user.player_info.inner_colour}, }
    game_state['gamePlayed'][user.username] = sesh_init()


def remove_snake(user):
    for _ in range(3):
        try:
            with transaction.atomic():
                game = GameState.objects.select_for_update().all()
                if len(game) != 0:
                    game = game[0]
                    game_state = json.loads(game.game_state)

                    sesh = game_state['gamePlayed'][user.username]
                    if sesh["score"] >= 0 and not sesh["saved"]:
                        other_user = User.objects.all().get(
                            username="the wall :(")
                        GamePlayed.objects.create(user=user,
                                                  start=sesh["start"],
                                                  end=timezone.now(),
                                                  score=sesh["score"],
                                                  eaten_by=other_user,
                                                  others_pwned=sesh[
                                                      "others_pwned"])

                        print('[SAVE]', "User left, saving...",
                              user.username)

                    if user.username in game_state["snakes"]:
                        del game_state["snakes"][user.username]
                        del game_state["extraInformation"][user.username]
                        game.game_state = json.dumps(game_state)
                        game.save()

                        PlayerState.objects.filter(
                            id=user.playerstate.id).select_for_update().get().delete()

                else:
                    PlayerState.objects.filter(
                        id=user.playerstate.id).select_for_update().get().delete()

                break
        except (OperationalError, IntegrityError) as e:
            print('[RETRY]', 'Discarding game board update due to conflict',
                  e)


def update_direction(user, dir):
    try:
        with transaction.atomic():
            player = PlayerState.objects.filter(
                id=user.playerstate.id).select_for_update().get()
            scale = (dir['x'] ** 2 + dir['y'] ** 2) ** 0.5
            if fpEqual(scale, 0):
                pass
                # keep last direction if somehow received (0, 0)
            else:
                if not fpEqual(scale, 1):
                    dir['x'] /= scale
                    dir['y'] /= scale
            player.direction = json.dumps(dir)
            player.save()
    except (OperationalError, IntegrityError) as e:
        print('[RETRY]', 'Discarding game board update due to conflict', e)


def calculateDistance(x1, y1, x2, y2):
    return math.sqrt(((x2 - x1) ** 2) + ((y2 - y1) ** 2))


## https://stackoverflow.com/questions/5595425/what-is-the-best-way-to-compare-floats-for-almost-equality-in-python
def fpEqual(a, b, rel_tol=1e-06, abs_tol=1e-06):
    return abs(a - b) <= max(rel_tol * max(abs(a), abs(b)), abs_tol)

from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie
from snake.models import GamePlayed, GamePlayedSerializer, PlayerInfo
from django.http import HttpResponse
from django.contrib.auth.models import User
import json
import os
from django.core.exceptions import ValidationError
from django.db import transaction, IntegrityError, OperationalError

# Respond back with the game landing page after the user has logged in
@ensure_csrf_cookie
@login_required
def game_page(request):

    #print(request.user)
    print(request.user.first_name)
    #print(request.user.id)

    picture = request.user.social_auth.get(provider='google-oauth2').extra_data['picture']
    request.session['picture'] = picture
    print("Extra Data is " + str(request.user.social_auth.get(provider='google-oauth2').extra_data))
    context = {"username": request.user.username}
    user = request.user 
    if not User.objects.filter(username="the wall :(").exists():
        wall = User(username="the wall :(")
        wall.save()
    # try really hard to create a user
    # even if it fails the get/post for colour request has a try block around locating said object
    for _ in range(5):
        try:
            with transaction.atomic():
                PlayerInfo.objects.update_or_create(user = user)
                player = PlayerInfo.objects.get(user = user)
                context["outer_colour"] = player.outer_colour
                context["inner_colour"] = player.inner_colour
            break
        except (OperationalError, IntegrityError) as e:
            print('Discarding user creation due to conflict', e)
    
    return render(request, 'snakes-page.html', context)


# Respond back with profile information for XML calls
@login_required
def profile_page(request):
    matches = GamePlayed.objects.all().filter(user = request.user).order_by('-start')
    dump = [GamePlayedSerializer(_).data for _ in matches.iterator()]
    response_json = json.dumps(dump)
    return HttpResponse(response_json, content_type = 'application/json')


# Respond back with leaderboard information for XML calls
@login_required
def leaderboards_page(request):
    matches = GamePlayed.objects.all().order_by('-score')
    context = [GamePlayedSerializer(_).data for _ in matches.iterator()]
    response_json = json.dumps(context)
    return HttpResponse(response_json, content_type = 'application/json')


# Handle GET or POST request related to snake body colours for authenticated users
@login_required
def user_colour(request):
    try:
        playerinfo = PlayerInfo.objects.get(user = request.user)
    except:
        return HttpResponse(status = 401)
    if request.method == "GET":
        # default colours
        context = {"outer_colour": "#000000", "inner_colour": "#f4f4f4"}
        try:
            context["outer_colour"] = playerinfo.outer_colour
            context["inner_colour"] = playerinfo.inner_colour
        finally:
            response_json = json.dumps(context)
        return HttpResponse(response_json, content_type = 'application/json', status = 200)
    
    elif request.method == "POST":
        try:
            body_part = request.POST["body"]
            value = request.POST["value"]
            if body_part == "outer-colour":
                playerinfo.outer_colour = value
            elif body_part == "inner-colour":
                playerinfo.inner_colour = value
       
            playerinfo.clean_fields()
            playerinfo.save()
        except:
            return HttpResponse(status = 400)
        return HttpResponse(status = 200)
    else:
        pass

         
    
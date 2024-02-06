var mousePosX = 700
var mousePosY = 700
var foodRadius = 15
var foodWidth = foodRadius * 2 * 0.8
var foodHeart = foodRadius * 2 * 1.2
var foodStar = foodRadius * 1.4
var drawBound = true
var boundaryColor = 'red'
var boundaryWidth = 4.3

let cv = document.getElementById("myCanvas");
cv.height = window.innerHeight
cv.width = window.innerWidth
ctx = cv.getContext("2d")
let circle = 2 * Math.PI
var P;
let initial_guess = 4.8;


function gameSetUp() {
    document.getElementById("endGameScreen").style.display = "none";
    P = new Game_Param()

    let canvas = document.getElementById("myCanvas");
    let game_margin = canvas.getBoundingClientRect()
    ctx.fillStyle = "#F4F4F4"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    var client_socket = new WebSocket('ws://' + window.location.host + '/ws/snake/')
    connect(client_socket, P.username)

    // attach direction vector updator
    cv.addEventListener("mousemove", (e) => {
        P.targ_x = e.offsetX
        P.targ_y = e.offsetY
        P.on_course = false
    })

    // setup direction update transmission loop
    P.update_interval = setInterval(() => {
        P.update_angle(P.targ_x, P.targ_y);
        let data = {
            "TYPE": 'DIRECTION',
            "username": P.username,
            "mouse_x": mousePosX - game_margin.left,
            "mouse_y": mousePosY - game_margin.top,
            "dir": P.dir,
        }
        if (client_socket.readyState === 1) {
            return client_socket.send(JSON.stringify(data))
        }
    }, 200)

    // setup scaler for responsive design
    window.onresize = () => {
        let cv = document.getElementById("myCanvas")
        cv.height = window.innerHeight
        cv.width = window.innerWidth
        P.grid.midx = Math.round(cv.width / 2)
        P.grid.midy = Math.round(cv.height / 2)
    }

    // setup render loop
    req_anim_frame();
}


// store all rendering related information
function Game_Param() {
    this.snakes = {}
    this.outer_colour = document.getElementById("outer-colour").value
    this.inner_colour = document.getElementById("inner-colour").value
    this.tail = {}
    this.updated_t = 0;
    this.grid = {
        "midx": Math.round(cv.width / 2),
        "midy": Math.round(cv.height / 2),
        "offx": 0,
        "offy": 0
    }
    this.food = {}
    this.username = username
    this.hz = initial_guess
    // directions
    this.dir = { "x": 0, "y": 0 }
    this.target_dir = { "x": 0, "y": 0 }
    this.theta_m = Math.PI / this.hz * 2
    this.last_received = 0;
    this.colours = {}
    this.images = {}
    this.images[username] = consImage(userImage)

}

// update angle method which incrementally steps though angle changes
//  to implement turn rate (subject to theta_m)
Game_Param.prototype.update_angle = function (targ_x, targ_y) {
    if (!targ_x || this.on_course || !this.head_x) {
        return
    }

    // find offset relative to middle of the page
    dx = targ_x - (this.grid.midx);
    dy = -(targ_y - (this.grid.midy));

    // unitize
    norm = (dx ** 2 + dy ** 2) ** 0.5;
    u_dx = dx / norm;
    u_dy = dy / norm;
    this.target_dir.x = u_dx;
    this.target_dir.y = -u_dy;

    if (this.dir.x === 0 && this.dir.y === 0) {
        // dont do any thing
        this.dir.x = u_dx;
        this.dir.y = -u_dy;
    } else {
        // get angle between current and target 
        let theta = Math.atan2(
            this.dir.x * u_dy + this.dir.y * u_dx,
            this.dir.x * u_dx - this.dir.y * u_dy)
        if (Math.abs(theta) < 0.1) {
            // if current direction is close to target, set oncourse flag to quit future angle updates
            this.on_course = true;
        }
        // https://stackoverflow.com/questions/2150050/finding-signed-angle-between-vectors
        theta = Math.max(-this.theta_m, Math.min(this.theta_m, theta))
        // rotation matrix
        u_dx = this.dir.x * Math.cos(theta) - -this.dir.y * Math.sin(theta)
        u_dy = this.dir.x * Math.sin(theta) + -this.dir.y * Math.cos(theta)
        this.dir.x = u_dx;
        this.dir.y = -u_dy;
    }
}


// loop to render right before a screen refresh at 60hz
function req_anim_frame(t) {

    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = "#F4F4F4"
    ctx.fillRect(0, 0, cv.width, cv.height)

    draw(t, P.username);
    for (let s in P.snakes) {
        if (s != P.username) draw(t, s);
    }
    drawFoods(ctx, P.food, P.head_x, P.head_y)
    P.req_id = requestAnimationFrame((t) => { req_anim_frame(t) });

}

// animation function to render the snakes, moving each coordinate in the array
//  and interpolating it to the coordinate of the preceeding element
function draw(t, user) {
    if (P.tail[user] == null) {
        return
    }
    let body = P.snakes[user]
    let dt = t - P.updated_t || t;

    // interpolate position based on time elapsed since last render
    let interpolate = Math.max(0, Math.min(dt / (1000 / P.hz), 1));
    let to_pct = interpolate, from_pct = 1 - to_pct;

    head_x = body[0].x * to_pct + body[1].x * from_pct
    head_y = body[0].y * to_pct + body[1].y * from_pct


    let l = body.length
    let pulse = t / 10 // pulse is now a period of 100ms
    for (let i = 0; i < l; i++) {
        if (i == 0) {
            // render head
            if (user == P.username) {
                P.head_x = head_x
                P.head_y = head_y
                P.grid.offx = P.grid.midx - P.head_x
                P.grid.offy = P.grid.midy - P.head_y
                pulse += P.grid.midx + P.grid.midy

                ctx.save();
                ctx.beginPath();
                ctx.arc(P.grid.midx, P.grid.midy, 20, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(P.images[user], P.grid.midx - 20, P.grid.midy - 20, 40, 40);
                ctx.restore();

                if (drawBound) {
                    drawBoundary(ctx, P.head_x, P.head_y, P.largeGridWidth, P.largeGridHeight)
                }
            } else {
                let segX = body[0].x * to_pct + body[1].x * from_pct
                let segY = body[0].y * to_pct + body[1].y * from_pct
                
                ctx.save();
                ctx.beginPath();
                ctx.arc((segX + P.grid.offx), (segY + P.grid.offy), 22, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(P.images[user], (segX + P.grid.offx) - 25, (segY + P.grid.offy) - 25, 50, 50);
                ctx.restore();
                pulse += segX + segY
                
            }
        } else if (i < l - 1) {
            // render body
            ctx.fillStyle = P.colours[user].outer_colour
            let segX = body[i].x * to_pct + body[i + 1].x * from_pct
            let segY = body[i].y * to_pct + body[i + 1].y * from_pct
            ctx.beginPath()
            pulse = pulse + 90
            ctx.arc(segX + P.grid.offx, segY + P.grid.offy, 15 * outer_seg_osc(pulse - 15), 0, circle)
            ctx.fill()
            ctx.save()
            ctx.fillStyle = P.colours[user].inner_colour
            ctx.beginPath()
            ctx.arc(segX + P.grid.offx, segY + P.grid.offy, 2 * seg_osc(pulse - 15), 0, circle)
            ctx.fill()
            ctx.restore()
        } else {
            // render tail, needs to be popped from previous state as this doesnt exist in the current state
            ctx.fillStyle = P.colours[user].outer_colour
            let interp = P.tail[user]
            let segX = body[l - 1].x * to_pct + interp.x * from_pct
            let segY = body[l - 1].y * to_pct + interp.y * from_pct
            ctx.beginPath()
            pulse = pulse + 90
            ctx.arc(segX + P.grid.offx, segY + P.grid.offy, 15 * outer_seg_osc(pulse - 15), 0, circle)
            ctx.fill()
            ctx.save()
            ctx.fillStyle = P.colours[user].inner_colour
            ctx.beginPath()
            ctx.arc(segX + P.grid.offx, segY + P.grid.offy, 2 * seg_osc(pulse - 15), 0, circle)
            ctx.fill()
            ctx.restore()
        }
    }
}


// behaviours for socket events
function connect(client_socket, username) {

    // send initial transmission data to consumer
    client_socket.onopen = function () {
        console.log('WebSockets connection created as' + username)
        alreadyDied = false;
        let data = { "TYPE": 'CONNECT', "username": username }
        client_socket.send(JSON.stringify(data))

    }

    // closing socket
    client_socket.onclose = function () {
        console.log('WebSockets connection closed.')
    }


    client_socket.onmessage = function (event) {

        // exponentially smooth broadcast per second to adapt to unstable updates
        let rec_t = performance.now()
        if (P.last_received == 0) {
            P.last_received = rec_t
        } else {
            let delta = rec_t - P.last_received
            P.last_received = rec_t
            P.hz = Math.min(0.7 * P.hz + 0.3 * (1000 / delta), 1.3 * P.hz) // > 130% will be treated as a spike and ignored
            // console.log("capped broadcast per second ", P.hz)
        }

        let canvas = document.getElementById("myCanvas")
        let ctx = canvas.getContext("2d")

        // update information needed to render the game
        let data = JSON.parse(event.data)
        P.largeGridWidth = data['GRID_DIMENSIONS']['width']
        P.largeGridHeight = data['GRID_DIMENSIONS']['height']
        if (P.username in data['ALL_SNAKES']) {
            document.getElementById("endGameScore").innerHTML = "Score: " + (data['ALL_SNAKES'][P.username].length - 6)
            P.head_x = data['ALL_SNAKES'][P.username][0].x
            P.head_y = data['ALL_SNAKES'][P.username][0].y

            // pop tail from previous state, needed to render the current frame (move from prev to curr)
            for (let s in P.snakes) {
                P.tail[s] = P.snakes[s].pop()
            }
            
            // save the current state
            P.snakes = data['ALL_SNAKES']

            // cache player info
            for (let s in P.snakes) {
                if (!(s in P.colours)) {
                    P.colours[s] = data["EXTRA_INFORMATION"][s].colours
                    P.images[s] = consImage(data["EXTRA_INFORMATION"][s].profile_picture)
                }
            }

            // needed to calculate the interval to interpolate over
            P.updated_t = performance.now()

            P.food = data['ALL_FOOD']
            updateLeaderboard(data['ALL_SNAKES'])

        } else {
            // dead
            clearInterval(P.update_interval)
            ctx.globalAlpha = 0.2
            ctx.fillStyle = "black"
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.globalAlpha = 1
            //Add Logic to make end game board visible
            document.getElementById("endGameScreen").style.display = "flex";

            console.log('trying to close socket')
            client_socket.close()

        }
    }

}


// Update the in-game leader board
function updateLeaderboard(data) {
    //We need to parse through the data and collect the usernames with their respective current scores
    var currentScoresArray = []

    for (const [username, userSnake] of Object.entries(data)) {
        currentScoresArray.push({ "username": username, "currentScore": userSnake.length - 6 })
    }

    currentScoresArray.sort(function (user1, user2) {
        return user2["currentScore"] - user1["currentScore"]
    });

    liveRankingsList = document.getElementById("liveRankingsList")
    liveRankingsList.innerHTML = ""
    for (var i = 0; i < currentScoresArray.length; i++) {
        var username = currentScoresArray[i]["username"]
        var currentScore = currentScoresArray[i]["currentScore"]

        var style = ""

        if (i + 1 == 1) {
            style = "color:gold; font-weight:bold;text-decoration:underline; text-shadow: 0px 0px 2px black, 0px 0px 2px black, 0px 0px 2px black,  0px 0px 2px black"
        }
        else if (i + 1 == 2) {
            style = "color:silver; font-weight:bold;text-decoration:underline; text-shadow: 0px 0px 2px black, 0px 0px 2px black, 0px 0px 2px black,  0px 0px 2px black"
        }
        else if (i + 1 == 3) {
            style = "color:#CD7F32; font-weight:bold;text-decoration:underline; text-shadow: 0px 0px 2px black, 0px 0px 2px black, 0px 0px 2px black,  0px 0px 2px black"
        }

        var addedHTML = "<p style='" + style + "'>"
        if (username == P.username) {
            addedHTML = addedHTML + "*"
        }
        addedHTML = addedHTML + (i + 1) + ". " + username + ": " + currentScore + "</p>"

        liveRankingsList.innerHTML = liveRankingsList.innerHTML + addedHTML
    }
}


// draw the red boundary for the game grid
function drawBoundary(ctx, userHeadX, userHeadY, largeGridWidth, largeGridHeight) {
    let canvas = document.getElementById("myCanvas")
    let gridMiddleX = Math.round(canvas.width / 2)
    let gridMiddleY = Math.round(canvas.height / 2)
    ctx.fillStyle = "black"

    //Boundary points in big grid are (0,0) (largeGridWidth,0) , (0, largeGridHeight), (largeGridWidth,largeGridHeight)
    boundaryCoordinateX = 0
    boundaryCoordinateY = 0

    // centering around the middle of the screen
    let relativeChangeX = userHeadX - boundaryCoordinateX
    let relativeChangeY = userHeadY - boundaryCoordinateY

    let relativeX = gridMiddleX - relativeChangeX
    let relativeY = gridMiddleY - relativeChangeY

    ctx.strokeStyle = boundaryColor;
    ctx.lineWidth = boundaryWidth;
    ctx.beginPath()

    ctx.moveTo(relativeX, relativeY)
    ctx.lineTo(relativeX + largeGridWidth, relativeY)
    ctx.stroke()

    ctx.moveTo(relativeX, relativeY)
    ctx.lineTo(relativeX, relativeY + largeGridHeight)
    ctx.stroke()

    ctx.moveTo(relativeX + largeGridWidth, relativeY)
    ctx.lineTo(relativeX + largeGridWidth, relativeY + largeGridHeight)
    ctx.stroke()

    ctx.moveTo(relativeX, relativeY + largeGridHeight)
    ctx.lineTo(relativeX + largeGridWidth, relativeY + largeGridHeight)
    ctx.stroke()

}


// a wrapper function to draw all of the shapes of the food
function drawFoods(ctx, foods, userHeadX, userHeadY) {
    let canvas = document.getElementById("myCanvas")
    let gridMiddleX = Math.round(canvas.width / 2)
    let gridMiddleY = Math.round(canvas.height / 2)
    for (let i = 0; i < foods.length; i++) {
        let relativeChangeX = userHeadX - foods[i].x
        let relativeChangeY = userHeadY - foods[i].y

        let relativeX = gridMiddleX - relativeChangeX
        let relativeY = gridMiddleY - relativeChangeY
        drawShapes(ctx, foods[i].shape, relativeX, relativeY, foods[i].color)
    }
}


// a function to selectivey draw food shapes
function drawShapes(ctx, shape, x, y, color) {
    switch (shape) {
        case "circle":
            drawCircle(ctx, x, y, color)
            break
        case "square":
            drawSquare(ctx, x, y, color)
            break
        case "heart":
            drawHeart(ctx, x, y, color)
            break
        case "star":
            drawStar(ctx, x, y, color)
            break
    }
}


// Aptly named
function drawCircle(ctx, x, y, color) {
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, foodRadius, 0, 2 * Math.PI)
    ctx.fill()
    ctx.restore()
}

// Aptly named
function drawSquare(ctx, x, y, color) {
    ctx.save()
    ctx.fillStyle = color
    ctx.fillRect(x - (foodWidth / 2), y - (foodWidth / 2), foodWidth, foodWidth)
    ctx.restore()
}


// referenced https://stackoverflow.com/questions/58333678/draw-heart-using-javascript-in-any-postionx-y
function drawHeart(ctx, x, y, color) {
    let topCurveHeight = foodHeart * 0.3

    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.translate(x, y - foodHeart / 4 - 3 * topCurveHeight / 4)
    ctx.moveTo(0, topCurveHeight)
    ctx.bezierCurveTo(0, 0,
        -foodHeart / 2, 0,
        -foodHeart / 2, topCurveHeight)
    ctx.bezierCurveTo(-foodHeart / 2, (foodHeart + topCurveHeight) / 2,
        0, (foodHeart + topCurveHeight) / 2, 0,
        foodHeart)
    ctx.bezierCurveTo(0, (foodHeart + topCurveHeight) / 2,
        foodHeart / 2, (foodHeart + topCurveHeight) / 2,
        foodHeart / 2, topCurveHeight)
    ctx.bezierCurveTo(foodRadius / 2, 0,
        0, 0,
        0, topCurveHeight)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}


//referenced https://stackoverflow.com/questions/25837158/how-to-draw-a-star-by-using-canvas-html5
function drawStar(ctx, x, y, color) {
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.translate(x, y)
    ctx.moveTo(0, -foodStar)
    for (let i = 0; i < 5; i++) {
        ctx.rotate(Math.PI / 5)
        ctx.lineTo(0, 0 - (foodStar * 0.5))
        ctx.rotate(Math.PI / 5)
        ctx.lineTo(0, 0 - foodStar)
    }
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}


// inner segment oscillations
function seg_osc(t) {
    return osc(t, 9, 100)
}


// outer segment oscillations
function outer_seg_osc(t) {
    return osc(t, 0.6, 100)
}


// return a growth factor based on passage of time
function osc(x, upper, period) {
    upper = upper / 2
    // console.log(upper/2*Math.sin(x*Math.PI/period)+upper/2 + 1)
    return upper / 2 * Math.sin(2 * x * Math.PI / period) + upper / 2 + 1
}


// used for caching profile image
function consImage(image) {
    img = document.createElement('img');
    img.src = image;
    return img
}

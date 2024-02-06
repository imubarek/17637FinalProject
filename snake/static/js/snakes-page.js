// Directs the user back to the main screen by changing display vis on elements
function toMain() {
    document.getElementById("profile-page").style.display = "none";
    // document.getElementById("game-page").style.display = "none";
    document.getElementById("ldb-page").style.display = "none";
    document.getElementById("main-page").style.display = "block";
    document.getElementById("liveLeaderboard").style.display = "none";
    document.getElementById("endGameScreen").style.display = "none";
    document.getElementById("myCanvas").style.display = "none";
}


 // Directs the user to either profile or leaderboard depending on the button
function toPage() {
    let page = this.getElementsByTagName("span")[0].innerText;
    document.getElementById("main-page").style.display = "none";
    switch(page) {
        case "Profile":
            document.getElementById("profile-page").style.display = "block";
            getProfile();
            break;
        case "Leaderboards":
            document.getElementById("ldb-page").style.display = "block";
            getGlobalLeaderboard();
            break;
        default:
    }
}


// Directs the user to the game page and calls gameSetUp
function play() {
    document.getElementById("main-page").style.display = "none";
    // document.getElementById("game-page").style.display = "block";
    page = document.getElementById("page")
    page.style.padding = "0px"
    document.getElementById("myCanvas").style.display = "block";
    document.getElementById("liveLeaderboard").style.display = "flex";

    return gameSetUp();
}


// Retrieve profile information and updates page through an XML request
function getProfile() {
    let xhr = new XMLHttpRequest();
    
    xhr.onreadystatechange = function() {
        if (this.readyState != 4) return;
        updateProfile(xhr);
    }
    
    xhr.open("GET", "profile/", true);
    xhr.send();
}


// Retrieve profile information and updates page through an XML request 
function getGlobalLeaderboard() {
    let xhr = new XMLHttpRequest();
    
    xhr.onreadystatechange = function() {
        if (this.readyState != 4) return;
        updateGlobalLeaderboard(xhr);
    }
    
    xhr.open("GET", "leaderboard/", true);
    xhr.send();
}


// Updates the profile information when an XML get is ready
function updateProfile(xhr) {
    
    if (xhr.status === 200 && xhr.getResponseHeader("content-type") === "application/json") {
        let response = JSON.parse(xhr.responseText)
        if (response.length > 0) {
            // document.getElementById("profile-username").innerHTML = response[0]['user']
            let $ = document.getElementById("profile-page")
            let old_tbody = document.getElementById("profile-match__body")
            let old_theader = document.getElementById("profile-match__header")
            let new_table = populateProfile(response, 20);
            new_table[0].setAttribute('id', 'profile-match__header')
            new_table[1].setAttribute('id', 'profile-match__body')
            
            old_tbody.parentNode.replaceChild(new_table[0], old_theader)
            old_tbody.parentNode.replaceChild(new_table[1], old_tbody)
        } else {
            // handle for no data
        }

    }
    //print error messages
}


// Updates the leaderboard information when an XML get is ready
function updateGlobalLeaderboard(xhr) {
    
    if (xhr.status === 200 && xhr.getResponseHeader("content-type") === "application/json") {
        let response = JSON.parse(xhr.responseText)
        if (response.length > 0) {
            let $ = document.getElementById("ldb-page")
            let old_tbody = document.getElementById("ldb__body")
            let old_theader = document.getElementById("ldb__header")
            let new_table = populateGlobalLeaderboard(response, 20);
            new_table[0].setAttribute('id', 'ldb__header')
            new_table[1].setAttribute('id', 'ldb__body')
            
            old_tbody.parentNode.replaceChild(new_table[0], old_theader)
            old_tbody.parentNode.replaceChild(new_table[1], old_tbody)
        } else {
            // handle for no data
        }

    }
    //print error messages
}


// populate the table with min(num, records retrieved)
function populateProfile(json_list, num) {
    // headers
    header_columns = ["Match date", "Score", "Survived for", "Crashed into", "Snakes crashed"]

    // populate thead according to headers
    let thead = document.createElement('thead')
    let th_row = thead.insertRow(-1)
    for (let i = 0; i < header_columns.length; i++) {
        th_row.insertCell(i).innerHTML = header_columns[i]
    }

    // populate the table
    let tbody = document.createElement('tbody')
    for (let i = 0; i < Math.min(num, json_list.length); i++) {
        let record = json_list[i]
        let row = tbody.insertRow(-1)

        for (let j = 0; j < header_columns.length; j++) {
            switch (header_columns[j]) {
                case "Match date":
                    row.insertCell(j).innerHTML = snakeDateTime(record["start"])
                    break;
                case "Score":
                    row.insertCell(j).innerHTML = record["score"]
                    break;
                case "Survived for":
                    row.insertCell(j).innerHTML = snakeDuration(record["start"], record["end"])
                    break;
                case "Crashed into":
                    row.insertCell(j).innerHTML = record["eaten_by"]
                    break;
                case "Snakes crashed":
                    row.insertCell(j).innerHTML = record["others_pwned"]
                    break;
            }
        }
    }
    return [thead, tbody]
}


// populate the table with min(num, records retrieved)
function populateGlobalLeaderboard(json_list, num) {
    // headers
    header_columns = ["User", "Match date", "Score", "Survived for", "Crashed into", "Snakes crashed"]

    // populate thead according to header columns
    let thead = document.createElement('thead')
    let th_row = thead.insertRow(-1)
    for (let i = 0; i < header_columns.length; i++) {
        th_row.insertCell(i).innerHTML = header_columns[i]
    }

    // populate the table
    let tbody = document.createElement('tbody')
    for (let i = 0; i < Math.min(num, json_list.length); i++) {
        let record = json_list[i]
        let row = tbody.insertRow(-1)

        for (let j = 0; j < header_columns.length; j++) {
            switch (header_columns[j]) {
                case "User":
                    row.insertCell(j).innerHTML = record["user"]
                    break;
                case "Match date":
                    row.insertCell(j).innerHTML = snakeDateTime(record["start"])
                    break;
                case "Score":
                    row.insertCell(j).innerHTML = record["score"]
                    break;
                case "Survived for":
                    row.insertCell(j).innerHTML = snakeDuration(record["start"], record["end"])
                    break;
                case "Crashed into":
                    row.insertCell(j).innerHTML = record["eaten_by"]
                    break;
                case "Snakes crashed":
                    row.insertCell(j).innerHTML = record["others_pwned"]
                    break;
            }
        }
    }
    return [thead, tbody]
}


//formats date times for leaderboards
function snakeDateTime(string) {
    let d = new Date(string)
    d = Intl.DateTimeFormat('en-US', {year: 'numeric', month:'numeric', day: 'numeric'}).format(d) 
        + " " 
        + Intl.DateTimeFormat('en-US', {timeStyle:"short"}).format(d)
    return d
}


// formats survival time
function snakeDuration(start, end) {
    start = new Date(start)
    end = new Date(end)

    let diff = Math.round((end - start)/1000)

    let sec = diff%60
    let min = (diff-sec)/60

    if (min === 0) return `${sec} seconds`;
    return `${min} minutes and ${sec} seconds`
}


// POSTS colour through an XML request
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color
function updateColour(event) {
    let xhr = new XMLHttpRequest();
    id = this.id
    value = event.target.value
    console.log(id, value)
    params = `body=${id}&value=${value}&csrfmiddlewaretoken=${getCSRFToken()}`
    console.log(params)
    xhr.open("POST", "user-colour/", true);
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.send(params);
}


// Retrieves the django csrf token stored in a cookie
function getCSRFToken() {
    let cookies = document.cookie.split(";")
    for (let i = 0; i < cookies.length; i++) {
        let c = cookies[i].trim()
        if (c.startsWith("csrftoken=")) {
            return c.substring("csrftoken=".length, c.length)
        }
    }
    return "unknown";
}
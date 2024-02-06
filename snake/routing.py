from django.urls import path

from . import consumer_server

# consumer handles all requests going to this url
websocket_urlpatterns = [
    path('ws/snake/', consumer_server.GameStateConsumer.as_asgi()),
]

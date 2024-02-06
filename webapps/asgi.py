"""
ASGI config for webapps project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.1/howto/deployment/asgi/
"""

import django
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'webapps.settings')
django.setup()

from django.core.asgi import get_asgi_application

django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from snake.routing import websocket_urlpatterns

# route based on protocol types first --> http:// vs ws://
application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket":
            AuthMiddlewareStack(URLRouter(websocket_urlpatterns)
                                ),
    }
)

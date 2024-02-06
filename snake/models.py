from django.contrib.auth.models import User
from django.db import models
from rest_framework import serializers
from django.core.validators import RegexValidator


# Information model for storing match histories for profile and leaderboard
class GamePlayed(models.Model):
    user = models.ForeignKey(User, on_delete=models.PROTECT,
                             related_name="game_user")
    start = models.DateTimeField()
    end = models.DateTimeField()
    modified = models.DateTimeField(auto_now=True)
    score = models.IntegerField(default=0)
    eaten_by = models.ForeignKey(User, on_delete=models.PROTECT,
                                 related_name="game_eaten_by")
    others_pwned = models.IntegerField(default=0)


# A serializer for the Information model above, used when users are requesting match information
class GamePlayedSerializer(serializers.ModelSerializer):
    user = serializers.SlugRelatedField(slug_field="username",
                                        queryset=User.objects.all())
    eaten_by = serializers.SlugRelatedField(slug_field="username",
                                            queryset=User.objects.all())
    class Meta:
        model = GamePlayed
        fields = "__all__"


# Model for storing game states in the game loop
class GameState(models.Model):
    game_state = models.JSONField()


# Model for storing persisting player information
class PlayerInfo(models.Model):
    user = models.OneToOneField(User, on_delete=models.PROTECT, related_name="player_info")
    outer_colour = models.TextField(default = "#000000", validators = [RegexValidator("#[a-f0-9]{6}")])
    inner_colour = models.TextField(default = "#f4f4f4", validators = [RegexValidator("#[a-f0-9]{6}")])


# Model for storing player direction updates
class PlayerState(models.Model):
    username = models.OneToOneField(User, on_delete=models.PROTECT)
    direction = models.JSONField()

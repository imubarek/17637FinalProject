#!/bin/bash

rm db.sqlite3
rm snake/migrations/0001*

python3 manage.py makemigrations
python3 manage.py migrate
python3 manage.py runserver


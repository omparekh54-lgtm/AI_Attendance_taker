from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='home'),
    path('api/health', views.health, name='health'),
    path('api/config', views.configuration, name='configuration'),
]

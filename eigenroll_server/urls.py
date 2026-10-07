from django.urls import path
from . import views, shared

urlpatterns = [
    path('', views.index, name='home'),
    path('api/health', views.health, name='health'),
    path('api/auth', shared.authentication),
    path('api/workspace', shared.workspace),
    path('api/enrollments', shared.enrollments),
    path('api/enroll', shared.enrollment),
    path('api/config', views.configuration, name='configuration'),
]

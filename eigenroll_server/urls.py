from django.urls import path
from . import views, shared, capture

urlpatterns = [
    path('', views.index, name='home'),
    path('api/health', views.health, name='health'),
    path('api/capture-session', capture.board),
    path('api/phone-capture', capture.phone),
    path('api/auth', shared.authentication),
    path('api/attendance', shared.attendance),
    path('api/workspace', shared.workspace),
    path('api/enrollments', shared.enrollments),
    path('api/enroll', shared.enrollment),
    path('api/side-views', shared.side_views),
    path('api/config', views.configuration, name='configuration'),
]


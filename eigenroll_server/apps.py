from django.contrib.staticfiles.apps import StaticFilesConfig

class EigenrollStaticFilesConfig(StaticFilesConfig):
    # Keep the Django-rendered document out of the public static CDN directory.
    ignore_patterns = ['CVS', '.*', '*~', 'index.html']

FROM lipanski/docker-static-website:latest
# Copy your static files
COPY ./noodles-editor/dist .
COPY ./noodles-editor/httpd.conf .
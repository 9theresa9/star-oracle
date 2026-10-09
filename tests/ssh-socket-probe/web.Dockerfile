FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY tests/ssh-socket-probe/nginx.conf /etc/nginx/probe.conf
COPY tests/ssh-socket-probe/start-web.sh /probe/start-web.sh
ENTRYPOINT ["/bin/sh", "/probe/start-web.sh"]

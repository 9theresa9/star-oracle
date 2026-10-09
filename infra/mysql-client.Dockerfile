# Official Oracle Linux and signature-verified Oracle MySQL client packages only.
# Package version changes require rebuilding and re-running the shared-stack CI.
# Sources: https://repo.mysql.com/yum/mysql-8.4-community/el/9/
# Key: https://dev.mysql.com/doc/refman/8.4/en/checking-gpg-signature.html
FROM oraclelinux:9-slim
RUN microdnf install -y ca-certificates curl gnupg2 gawk \
 && curl --fail --silent --show-error --location https://repo.mysql.com/RPM-GPG-KEY-mysql-2025 -o /tmp/mysql-key \
 && test "$(gpg --batch --show-keys --with-colons /tmp/mysql-key 2>/dev/null | awk -F: '$1 == "fpr" {print $10; exit}')" = BCA43417C3B485DD128EC6D4B7B3B788A8D3785C \
 && rpm --import /tmp/mysql-key \
 && printf '%s\n' '[mysql84-client]' 'name=Oracle MySQL 8.4 client' 'baseurl=https://repo.mysql.com/yum/mysql-8.4-community/el/9/$basearch/' 'enabled=1' 'gpgcheck=1' 'gpgkey=https://repo.mysql.com/RPM-GPG-KEY-mysql-2025' > /etc/yum.repos.d/mysql84-client.repo \
 && microdnf install -y mysql-community-client-8.4.8-1.el9 mysql-community-client-plugins-8.4.8-1.el9 mysql-community-common-8.4.8-1.el9 \
 && mysql --no-defaults --version \
 && mysqldump --no-defaults --version \
 && ! command -v mysqld \
 && ! rpm -q mysql-community-server \
 && microdnf clean all \
 && rm -rf /var/cache/dnf /tmp/mysql-key /root/.gnupg
ENV HOME=/nonexistent
USER 10001:10001
WORKDIR /tmp
CMD ["mysql", "--no-defaults", "--no-login-paths", "--version"]

#!/bin/sh
set -eu

# Amvera подключает постоянный том /data уже после сборки образа: каталоги готовим
# от root, затем запускаем сервер от непривилегированного пользователя node.
if [ "$(id -u)" = 0 ]; then
  install -d -m 700 -o node -g node "${STORAGE_PATH:-/data/storage}"
  # Раньше сервер работал от root — файлы, созданные тогда, передаём node.
  chown -R node:node "${STORAGE_PATH:-/data/storage}"
  # Встроенный антивирус для загрузок модуля «Акты ТП» (из TP_Approval): слушает
  # только 127.0.0.1, сигнатуры хранятся на томе.
  if [ "${CLAMAV_HOST:-}" = 127.0.0.1 ]; then
    install -d -m 755 -o clamav -g clamav /data/clamav /run/clamav
    [ -f /data/clamav/main.cvd ] || [ -f /data/clamav/main.cld ] || freshclam --stdout || echo 'freshclam: первая загрузка сигнатур не удалась, повтор в фоне.' >&2
    freshclam -d --stdout || true
    clamd || echo 'clamd не запущен: загрузка документов в «Актах ТП» будет недоступна.' >&2
  fi
  exec gosu node "$0" "$@"
fi
exec "$@"

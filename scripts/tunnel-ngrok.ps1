# Бесплатный доступ к localhost:3000 из интернета через HTTPS.
# 1) https://ngrok.com/download — установить ngrok
# 2) Один раз: ngrok config add-authtoken <токен из личного кабинета>
# 3) В другой консоли: cd backend && npm start
# 4) Запустить этот скрипт, скопировать "Forwarding" https://.... в local.properties:
#    api.base.url=https://....ngrok-free.app
# 5) Пересобрать приложение (Build — Rebuild Project).

Write-Host "Ожидаю бэкенд на http://localhost:3000 ..." -ForegroundColor Cyan
& ngrok http 3000

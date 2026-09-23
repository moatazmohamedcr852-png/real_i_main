@echo off
setlocal
title REAL_i Backend (PostgreSQL)
cd /d "%~dp0"

echo.
echo  ===============================================
echo   REAL_i ADMIN ACCOUNT
echo   Email:    admin@local.test
echo   Password: LocalAdmin1234
echo  ===============================================
echo.

cd /d "%~dp0\backend"

if not exist "node_modules" (
  echo Installing backend dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting PostgreSQL...
call node db\setup-local-pg.js
if errorlevel 1 (
  echo [ERROR] Could not start PostgreSQL. See message above.
  pause
  exit /b 1
)

echo Running migrations...
call npm run migrate
if errorlevel 1 pause

echo Seeding admin + demo data...
call npm run seed

echo.
echo Backend URL:     http://localhost:3001
echo Login page:      http://localhost:3001/login
echo Admin login:     admin@local.test  /  LocalAdmin1234
echo.
echo Starting server...
echo.

call npm start

echo.
echo Server stopped.
pause
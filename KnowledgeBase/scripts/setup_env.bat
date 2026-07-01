@echo off
REM Bootstrap a Python virtualenv for the KnowledgeBase pipeline on Windows.
REM
REM Creates  <KB_ROOT>\.venv  and installs requirements.txt into it.
REM BrainPilot's web "Build Knowledge Base" button and the build_kb.py CLI
REM auto-detect this venv — no extra env vars needed afterwards.
REM
REM Usage:
REM   scripts\setup_env.bat
REM   scripts\setup_env.bat --reinstall
REM
REM Requirements:
REM   - Python >= 3.10 on PATH (or pass --python C:\path\to\python.exe)
REM   - ~5 GB free disk
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
for %%i in ("%SCRIPT_DIR%..") do set "KB_ROOT=%%~fi"
set "VENV_DIR=%KB_ROOT%\.venv"
set "REQ_FILE=%KB_ROOT%\requirements.txt"

set "PYTHON_BIN="
set "REINSTALL=0"

:parse_args
if "%~1"=="" goto :args_done
if "%~1"=="--python" (
  set "PYTHON_BIN=%~2"
  shift & shift
  goto :parse_args
)
if "%~1"=="--reinstall" (
  set "REINSTALL=1"
  shift
  goto :parse_args
)
echo unknown flag: %~1
exit /b 1

:args_done

if "%PYTHON_BIN%"=="" (
  for %%c in (python3.12 python3.11 python3.10 python3 python) do (
    where %%c >nul 2>nul && (set "PYTHON_BIN=%%c" & goto :py_found)
  )
  :py_found
)

if "%PYTHON_BIN%"=="" (
  echo ERROR: no python interpreter found on PATH. Pass --python C:\path\to\python.exe
  exit /b 1
)

echo [setup_env] using %PYTHON_BIN%

if not exist "%REQ_FILE%" (
  echo ERROR: %REQ_FILE% not found — is the KnowledgeBase tree intact?
  exit /b 1
)

if "%REINSTALL%"=="1" if exist "%VENV_DIR%" (
  echo [setup_env] --reinstall: removing %VENV_DIR%
  rmdir /s /q "%VENV_DIR%"
)

if not exist "%VENV_DIR%" (
  echo [setup_env] creating venv at %VENV_DIR%
  "%PYTHON_BIN%" -m venv "%VENV_DIR%"
  if errorlevel 1 exit /b 1
)

set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
if not exist "%VENV_PY%" (
  echo ERROR: venv looks broken — %VENV_PY% missing.
  exit /b 1
)

echo [setup_env] upgrading pip / wheel
"%VENV_PY%" -m pip install --upgrade pip wheel >nul

echo [setup_env] installing requirements.txt (may take several minutes)
"%VENV_PY%" -m pip install -r "%REQ_FILE%"
if errorlevel 1 exit /b 1

echo [setup_env] done.
echo.
echo   Venv:    %VENV_DIR%
echo   Python:  %VENV_PY%
echo.
echo BrainPilot's web 'Build Knowledge Base' button and the build_kb.py CLI
echo both auto-detect this venv. No extra env vars to set.

endlocal

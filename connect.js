#!/usr/bin/env node

const net = require('net');
const os = require('os');
const path = require('path');

const SOCKET_PATH_UNIX = '/tmp/edumeet-room-server.sock';
const SOCKET_PATH_WIN = path.join('\\\\?\\pipe', process.cwd(), 'edumeet-room-server');
const SOCKET_PATH = os.platform() === 'win32'? SOCKET_PATH_WIN : SOCKET_PATH_UNIX;
const socket = net.connect(SOCKET_PATH);

process.stdin.pipe(socket);
socket.pipe(process.stdout);

socket.on('connect', () => process.stdin.setRawMode(true));
socket.on('close', () => process.exit(0));
socket.on('exit', () => socket.end());
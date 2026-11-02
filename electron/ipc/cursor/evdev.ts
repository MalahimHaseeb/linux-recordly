import fs from "node:fs";
import { getScreen } from "../utils";
import { setLinuxCursorScreenPoint } from "../state";
import { recordCursorMouseDown, recordCursorMouseUp } from "./interaction";
import { isLikelyLinuxWaylandSession } from "../register/sourceMapping";

const INPUT_EVENT_SIZE = 24;
const EV_SYN = 0;
const EV_KEY = 1;
const EV_REL = 2;
const REL_X = 0;
const REL_Y = 1;
const BTN_LEFT = 272;
const BTN_RIGHT = 273;
const BTN_MIDDLE = 274;

let running = false;
const openDevices: Array<{ fd: number; path: string }> = [];
const readTimers: NodeJS.Timeout[] = [];
let heartbeatTimer: NodeJS.Timeout | null = null;

let cursorX = 0;
let cursorY = 0;
let screenWidth = 1920;
let screenHeight = 1080;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function updateCursorPosition() {
	setLinuxCursorScreenPoint({
		x: cursorX,
		y: cursorY,
		updatedAt: Date.now(),
	});
}

function parseEvents(buffer: Buffer, bytesRead: number) {
	const eventCount = Math.floor(bytesRead / INPUT_EVENT_SIZE);

	for (let index = 0; index < eventCount; index += 1) {
		const offset = index * INPUT_EVENT_SIZE;
		const type = buffer.readUInt16LE(offset + 16);
		const code = buffer.readUInt16LE(offset + 18);
		const value = buffer.readInt32LE(offset + 20);

		if (type === EV_REL) {
			if (code === REL_X) {
				cursorX = clamp(cursorX + value, 0, screenWidth);
			} else if (code === REL_Y) {
				cursorY = clamp(cursorY + value, 0, screenHeight);
			}
			continue;
		}

		if (type === EV_KEY) {
			if (code === BTN_LEFT || code === BTN_RIGHT || code === BTN_MIDDLE) {
				updateCursorPosition();
				if (value === 1) {
					const button = code === BTN_RIGHT ? 2 : code === BTN_MIDDLE ? 3 : 1;
					recordCursorMouseDown(button);
				} else if (value === 0) {
					recordCursorMouseUp();
				}
			}
			continue;
		}

		if (type === EV_SYN) {
			updateCursorPosition();
		}
	}
}

function readDevice(devicePath: string, fd: number) {
	if (!running) {
		return;
	}

	const buffer = Buffer.alloc(INPUT_EVENT_SIZE * 256);

	try {
		const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
		if (bytesRead && bytesRead > 0) {
			parseEvents(buffer, bytesRead);
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | null)?.code;
		if (code !== "EAGAIN" && code !== "EWOULDBLOCK") {
			console.warn("[EvdevInput] Read failed for", devicePath, error);
		}
	}

	const timer = setTimeout(() => readDevice(devicePath, fd), 16);
	readTimers.push(timer);
}

export function shouldUseEvdevInputCapture(env: NodeJS.ProcessEnv = process.env): boolean {
	return process.platform === "linux" && isLikelyLinuxWaylandSession(env);
}

export async function startEvdevInputCapture() {
	stopEvdevInputCapture();
	running = true;

	try {
		const screen = getScreen();
		const display = screen.getPrimaryDisplay();
		const scaleFactor = display.scaleFactor || 1;
		screenWidth = Math.max(1, Math.round(display.size.width * scaleFactor));
		screenHeight = Math.max(1, Math.round(display.size.height * scaleFactor));
		cursorX = Math.round(screenWidth / 2);
		cursorY = Math.round(screenHeight / 2);
		updateCursorPosition();
		heartbeatTimer = setInterval(updateCursorPosition, 250);
	} catch (error) {
		console.warn("[EvdevInput] Could not initialize screen dimensions:", error);
	}

	let devicePaths: string[] = [];
	try {
		devicePaths = fs
			.readdirSync("/dev/input")
			.filter((name) => /^event\d+$/.test(name))
			.map((name) => `/dev/input/${name}`)
			.sort();
	} catch (error) {
		console.warn("[EvdevInput] Could not enumerate input devices:", error);
		return;
	}

	let openedCount = 0;
	for (const devicePath of devicePaths) {
		try {
			const fd = fs.openSync(
				devicePath,
				fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
			);
			openDevices.push({ fd, path: devicePath });
			openedCount += 1;
			readDevice(devicePath, fd);
		} catch {
			// Permission denied or device unavailable; skip silently.
		}
	}

	if (openedCount === 0) {
		console.warn(
			"[EvdevInput] No readable input devices. Add your user to the 'input' group and log out/in: sudo usermod -aG input $USER",
		);
	} else {
		console.log("[EvdevInput] Capturing pointer input from", openedCount, "device(s).");
	}
}

export function stopEvdevInputCapture() {
	running = false;

	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}

	for (const timer of readTimers.splice(0)) {
		clearTimeout(timer);
	}

	for (const device of openDevices.splice(0)) {
		try {
			fs.closeSync(device.fd);
		} catch {
			// Ignore close errors.
		}
	}
}
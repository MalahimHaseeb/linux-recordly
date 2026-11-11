import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
	const os = await import("node:os");
	return {
		app: {
			getPath: () => os.tmpdir(),
		},
	};
});

vi.mock("node:child_process", () => ({
	execFile: (
		_file: string,
		args: string[],
		_options: Record<string, unknown>,
		callback: (error: Error | null, stdout?: string, stderr?: string) => void,
	) => {
		const outputPath = args[args.length - 1];
		writeFileSync(outputPath, "cleaned-voice");
		callback(null, "", "");
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "ffmpeg",
}));

describe("voice cleaning", () => {
	let tempRoot: string;
	let videoPath: string;
	let micPath: string;

	beforeEach(async () => {
		vi.resetModules();
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-voice-clean-"));
		videoPath = path.join(tempRoot, "recording.mp4");
		micPath = path.join(tempRoot, "recording.mic.wav");
		await Promise.all([
			fs.writeFile(videoPath, "video"),
			fs.writeFile(micPath, "original-mic"),
			fs.writeFile(`${micPath}.json`, JSON.stringify({ startDelayMs: 250 })),
		]);
	});

	afterEach(async () => {
		vi.resetModules();
		if (tempRoot) {
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("builds a cleaned sidecar path next to the original mic recording", async () => {
		const { getVoiceCleanedPath } = await import("./voiceCleaning");

		expect(getVoiceCleanedPath("/tmp/recording.mic.wav")).toBe(
			"/tmp/recording.mic.cleaned.wav",
		);
		expect(getVoiceCleanedPath("/tmp/recording.mic.m4a")).toBe(
			"/tmp/recording.mic.cleaned.wav",
		);
	});

	it("uses progressively stronger noise-reduction filters", async () => {
		const { getVoiceCleanupFilters } = await import("./voiceCleaning");

		expect(getVoiceCleanupFilters("light").join(",")).toContain("afftdn=nr=12");
		expect(getVoiceCleanupFilters("balanced").join(",")).toContain("afftdn=nr=20");
		expect(getVoiceCleanupFilters("strong").join(",")).toContain("afftdn=nr=28");
		expect(getVoiceCleanupFilters("strong").join(",")).toContain(
			"aresample=async=1:first_pts=0",
		);
	});

	it("reports the mic track as cleanable and detects a cleaned copy", async () => {
		const { cleanVoiceTrack, getVoiceCleanStatus } = await import("./voiceCleaning");

		await expect(getVoiceCleanStatus(videoPath)).resolves.toEqual({
			available: true,
			isCleaned: false,
			micPath,
			cleanedPath: path.join(tempRoot, "recording.mic.cleaned.wav"),
		});

		await expect(cleanVoiceTrack(videoPath)).resolves.toEqual({
			success: true,
			path: path.join(tempRoot, "recording.mic.cleaned.wav"),
		});

		const status = await getVoiceCleanStatus(videoPath);
		expect(status).toEqual({
			available: true,
			isCleaned: true,
			micPath,
			cleanedPath: path.join(tempRoot, "recording.mic.cleaned.wav"),
		});
	});

	it("prefers the cleaned copy while keeping the original available for restore", async () => {
		const { cleanVoiceTrack, getPreferredMicSidecarPath, restoreVoiceTrack } = await import(
			"./voiceCleaning"
		);
		const cleanedPath = path.join(tempRoot, "recording.mic.cleaned.wav");

		await cleanVoiceTrack(videoPath);
		await expect(getPreferredMicSidecarPath(micPath)).resolves.toBe(cleanedPath);

		await expect(restoreVoiceTrack(videoPath)).resolves.toEqual({ success: true });
		await expect(getPreferredMicSidecarPath(micPath)).resolves.toBe(micPath);
		await expect(fs.stat(cleanedPath)).rejects.toThrow();
		await expect(fs.readFile(micPath, "utf8")).resolves.toBe("original-mic");
	});

	it("copies timing metadata onto the cleaned sidecar", async () => {
		const { cleanVoiceTrack } = await import("./voiceCleaning");

		await cleanVoiceTrack(videoPath);

		await expect(
			fs.readFile(path.join(tempRoot, "recording.mic.cleaned.wav.json"), "utf8"),
		).resolves.toBe(JSON.stringify({ startDelayMs: 250 }));
	});

	it("reports unavailable when no microphone sidecar exists", async () => {
		const { getVoiceCleanStatus } = await import("./voiceCleaning");

		await fs.rm(micPath, { force: true });

		await expect(getVoiceCleanStatus(videoPath)).resolves.toEqual({
			available: false,
			isCleaned: false,
			micPath: null,
			cleanedPath: null,
		});
	});
});

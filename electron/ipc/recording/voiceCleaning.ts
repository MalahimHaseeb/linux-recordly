import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { COMPANION_AUDIO_LAYOUTS } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

const execFileAsync = promisify(execFile);

export type VoiceCleanupStrength = "light" | "balanced" | "strong";

export interface VoiceCleanStatus {
	available: boolean;
	isCleaned: boolean;
	micPath: string | null;
	cleanedPath: string | null;
}

interface VoiceCleanStatusOptions {
	/** True when the video file itself contains an audio track. */
	hasEmbeddedAudio?: boolean;
	/** False when a mic sidecar exists but is not routed as its own track. */
	useMicSidecar?: boolean;
}

const VOICE_CLEANUP_FILTERS: Record<VoiceCleanupStrength, string[]> = {
	light: [
		"highpass=f=100",
		"lowpass=f=9000",
		"afftdn=nr=14:nf=-46:tn=1",
		"anlmdn=s=6:p=0.002:r=0.006",
		"agate=threshold=0.02:ratio=2:attack=15:release=200",
	],
	balanced: [
		"highpass=f=100",
		"lowpass=f=8500",
		"afftdn=nr=22:nf=-40:tn=1",
		"anlmdn=s=8:p=0.002:r=0.006",
		"agate=threshold=0.04:ratio=3:attack=10:release=180",
		"alimiter=limit=0.95:level=0",
	],
	strong: [
		"highpass=f=120",
		"lowpass=f=8000",
		"afftdn=nr=30:nf=-34:tn=1",
		"anlmdn=s=12:p=0.002:r=0.006",
		"agate=threshold=0.06:ratio=4:attack=8:release=160",
		"alimiter=limit=0.95:level=0",
	],
};

const VOICE_CLEANUP_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function normalizeVoiceCleanupStrength(value: unknown): VoiceCleanupStrength {
	return value === "light" || value === "strong" || value === "balanced" ? value : "balanced";
}

export function getVoiceCleanupFilters(strength?: unknown): string[] {
	const filters = VOICE_CLEANUP_FILTERS[normalizeVoiceCleanupStrength(strength)];
	return [...filters, "aresample=async=1:first_pts=0"];
}

/** Path of the denoised copy of a microphone sidecar, e.g. recording.mic.cleaned.wav */
export function getVoiceCleanedPath(micPath: string): string {
	return `${micPath.replace(/\.[^.]+$/u, "")}.cleaned.wav`;
}

/**
 * Path of a denoised copy of the video's embedded audio track. Linux browser
 * captures mix the microphone and system audio into the video, so there is no
 * standalone mic sidecar to process.
 */
export function getEmbeddedVoiceCleanedPath(videoPath: string): string {
	return `${videoPath.replace(/\.[^.]+$/u, "")}.mixed.cleaned.wav`;
}

function getMicSidecarCandidates(videoPath: string): string[] {
	const basePath = videoPath.replace(/\.[^.]+$/u, "");
	return COMPANION_AUDIO_LAYOUTS.map((layout) => `${basePath}${layout.micSuffix}`);
}

async function isUsableFile(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile() && stat.size > 0;
	} catch {
		return false;
	}
}

async function findExistingMicSidecarPath(videoPath: string): Promise<string | null> {
	for (const candidate of getMicSidecarCandidates(videoPath)) {
		if (await isUsableFile(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function findExistingCleanedVoicePath(videoPath: string): Promise<string | null> {
	for (const candidate of getMicSidecarCandidates(videoPath)) {
		const cleanedPath = getVoiceCleanedPath(candidate);
		if (await isUsableFile(cleanedPath)) {
			return cleanedPath;
		}
	}
	return null;
}

export async function getVoiceCleanStatus(
	videoPath: string,
	options: VoiceCleanStatusOptions = {},
): Promise<VoiceCleanStatus> {
	if (options.useMicSidecar !== false) {
		const [micPath, cleanedPath] = await Promise.all([
			findExistingMicSidecarPath(videoPath),
			findExistingCleanedVoicePath(videoPath),
		]);

		if (micPath || cleanedPath) {
			return {
				available: true,
				isCleaned: Boolean(cleanedPath),
				micPath,
				cleanedPath: cleanedPath ?? (micPath ? getVoiceCleanedPath(micPath) : null),
			};
		}
	}

	// No standalone microphone track: clean the embedded/mixed audio instead.
	const embeddedCleanedPath = getEmbeddedVoiceCleanedPath(videoPath);
	const embeddedCleanedExists = await isUsableFile(embeddedCleanedPath);
	if (options.hasEmbeddedAudio || embeddedCleanedExists) {
		return {
			available: true,
			isCleaned: embeddedCleanedExists,
			micPath: null,
			cleanedPath: embeddedCleanedPath,
		};
	}

	return {
		available: false,
		isCleaned: false,
		micPath: null,
		cleanedPath: null,
	};
}

/**
 * Returns the sidecar that should be used for playback and export. When a
 * cleaned copy exists it wins over the original microphone recording.
 */
export async function getPreferredMicSidecarPath(micPath: string): Promise<string> {
	const cleanedPath = getVoiceCleanedPath(micPath);
	return (await isUsableFile(cleanedPath)) ? cleanedPath : micPath;
}

async function copySidecarTimingMetadata(sourcePath: string, targetPath: string) {
	try {
		const raw = await fs.readFile(`${sourcePath}.json`, "utf8");
		await fs.writeFile(`${targetPath}.json`, raw, "utf8");
	} catch {
		await fs.rm(`${targetPath}.json`, { force: true }).catch(() => undefined);
	}
}

export async function cleanVoiceTrack(
	videoPath: string,
	options?: {
		strength?: unknown;
		hasEmbeddedAudio?: boolean;
		useMicSidecar?: boolean;
	},
): Promise<{ success: true; path: string } | { success: false; error: string }> {
	const status = await getVoiceCleanStatus(videoPath, {
		hasEmbeddedAudio: options?.hasEmbeddedAudio,
		useMicSidecar: options?.useMicSidecar,
	});
	if (!status.available) {
		return {
			success: false,
			error: "No microphone or embedded audio was found for this video.",
		};
	}

	const microphonePath = status.micPath;
	const inputPath = microphonePath ?? videoPath;
	const outputPath = microphonePath
		? getVoiceCleanedPath(microphonePath)
		: getEmbeddedVoiceCleanedPath(videoPath);
	const tempOutputPath = `${outputPath}.tmp.wav`;

	try {
		await execFileAsync(
			getFfmpegBinaryPath(),
			[
				"-y",
				"-hide_banner",
				"-nostdin",
				"-nostats",
				"-i",
				inputPath,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"48000",
				"-af",
				getVoiceCleanupFilters(options?.strength).join(","),
				"-c:a",
				"pcm_s16le",
				tempOutputPath,
			],
			{ timeout: VOICE_CLEANUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
		);
		await fs.rename(tempOutputPath, outputPath);
		if (microphonePath) {
			await copySidecarTimingMetadata(microphonePath, outputPath);
		}
		return { success: true, path: outputPath };
	} catch (error) {
		await fs.rm(tempOutputPath, { force: true }).catch(() => undefined);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function restoreVoiceTrack(
	videoPath: string,
): Promise<{ success: true } | { success: false; error: string }> {
	try {
		const status = await getVoiceCleanStatus(videoPath);
		const cleanedPaths = new Set<string>();
		if (status.cleanedPath) {
			cleanedPaths.add(status.cleanedPath);
		}
		cleanedPaths.add(getEmbeddedVoiceCleanedPath(videoPath));
		for (const candidate of getMicSidecarCandidates(videoPath)) {
			cleanedPaths.add(getVoiceCleanedPath(candidate));
		}

		await Promise.all(
			Array.from(cleanedPaths).flatMap((cleanedPath) => [
				fs.rm(cleanedPath, { force: true }).catch(() => undefined),
				fs.rm(`${cleanedPath}.json`, { force: true }).catch(() => undefined),
				fs.rm(`${cleanedPath}.tmp.wav`, { force: true }).catch(() => undefined),
			]),
		);
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

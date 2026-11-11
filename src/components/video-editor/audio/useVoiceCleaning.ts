import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface UseVoiceCleaningParams {
	currentSourcePath: string | null;
	refreshKey?: number;
	onChanged?: () => void;
	summarizeErrorMessage: (message: string) => string;
}

export interface VoiceCleaningController {
	available: boolean;
	isCleaned: boolean;
	isProcessing: boolean;
	onCleanVoiceChange: (enabled: boolean) => void;
}

export function useVoiceCleaning({
	currentSourcePath,
	refreshKey = 0,
	onChanged,
	summarizeErrorMessage,
}: UseVoiceCleaningParams): VoiceCleaningController {
	const [available, setAvailable] = useState(false);
	const [isCleaned, setIsCleaned] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const processingRef = useRef(false);
	const loadedSourcePathRef = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		// Refetch after the editor is refreshed or a cleanup finishes.
		void refreshKey;

		if (loadedSourcePathRef.current !== currentSourcePath) {
			loadedSourcePathRef.current = currentSourcePath;
			setAvailable(false);
			setIsCleaned(false);
		}

		if (!currentSourcePath) {
			return () => {
				cancelled = true;
			};
		}

		void (async () => {
			try {
				const result = await window.electronAPI.getVoiceCleanStatus(currentSourcePath);
				if (cancelled) return;
				if (result.success) {
					setAvailable(Boolean(result.available));
					setIsCleaned(Boolean(result.isCleaned));
				} else {
					setAvailable(false);
					setIsCleaned(false);
				}
			} catch {
				if (!cancelled) {
					setAvailable(false);
					setIsCleaned(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [currentSourcePath, refreshKey]);

	const onCleanVoiceChange = useCallback(
		(enabled: boolean) => {
			if (
				!currentSourcePath ||
				processingRef.current ||
				isProcessing ||
				enabled === isCleaned
			) {
				return;
			}

			processingRef.current = true;
			setIsProcessing(true);
			void (async () => {
				try {
					const result = enabled
						? await window.electronAPI.cleanVoiceTrack(currentSourcePath)
						: await window.electronAPI.restoreVoiceTrack(currentSourcePath);
					if (!result.success) {
						throw new Error(result.error || "Voice cleanup failed");
					}

					setAvailable(true);
					setIsCleaned(enabled);
					toast.success(
						enabled
							? "Voice cleaned. Background noise has been reduced."
							: "Voice cleanup removed. Using the original microphone audio.",
					);
					onChanged?.();
				} catch (error) {
					toast.error(
						`Could not ${enabled ? "clean" : "restore"} voice: ${summarizeErrorMessage(
							error instanceof Error ? error.message : String(error),
						)}`,
						{ duration: 10000 },
					);
				} finally {
					processingRef.current = false;
					setIsProcessing(false);
				}
			})();
		},
		[currentSourcePath, isCleaned, isProcessing, onChanged, summarizeErrorMessage],
	);

	return { available, isCleaned, isProcessing, onCleanVoiceChange };
}

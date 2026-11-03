import {
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	microphoneEnabled: boolean;
	webcamEnabled?: boolean;
	onToggleMicrophone: () => void;
	onToggleWebcam?: () => void;
	elapsed: number;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}

export const RecordingControls = ({
	paused,
	microphoneEnabled,
	webcamEnabled,
	onToggleMicrophone,
	onToggleWebcam,
	elapsed,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) => {
	const t = useScopedT("launch");

	const memoizedControls = useMemo(() => {
		return (
			<>
				<div className="flex items-center gap-[5px]">
					<div
						className={`w-[7px] h-[7px] rounded-full ${
							paused ? "bg-[#fbbf24]" : `bg-[#f43f5e] ${styles.recDotBlink}`
						}`}
					/>
					<span
						className={`text-[10px] font-bold tracking-[0.06em] ${
							paused ? "text-[#fbbf24]" : "text-[#f43f5e]"
						}`}
					>
						{paused ? t("recording.paused") : t("recording.rec")}
					</span>
				</div>

				<span
					className={`font-mono text-xs font-semibold min-w-[52px] text-center tracking-[0.02em] ${
						paused ? "text-[#fbbf24]" : "text-[var(--launch-text)]"
					}`}
				>
					{formatTime(elapsed)}
				</span>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					className={microphoneEnabled ? styles.ibActive : ""}
					aria-label={
						microphoneEnabled
							? t("recording.disableMicrophone")
							: t("recording.enableMicrophone")
					}
					title={
						microphoneEnabled
							? t("recording.disableMicrophone")
							: t("recording.enableMicrophone")
					}
					onClick={onToggleMicrophone}
				>
					{microphoneEnabled ? (
						<MicrophoneIcon size={18} />
					) : (
						<MicrophoneSlashIcon size={18} />
					)}
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					className={webcamEnabled ? styles.ibActive : ""}
					aria-label={
						webcamEnabled
							? t("recording.disableWebcam")
							: t("recording.enableWebcam")
					}
					title={
						webcamEnabled
							? t("recording.disableWebcam")
							: t("recording.enableWebcam")
					}
					onClick={onToggleWebcam}
				>
					{webcamEnabled ? (
						<VideoCameraIcon size={18} />
					) : (
						<VideoCameraSlashIcon size={18} />
					)}
				</Button>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant={paused ? "default" : "ghost"}
					size="icon"
					iconSize="lg"
					onClick={onPauseResume}
					title={paused ? t("recording.resume") : t("recording.pause")}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
					className={paused ? styles.ibGreen : ""}
				>
					{paused ? (
						<PlayIcon size={18} fill="currentColor" strokeWidth={0} />
					) : (
						<PauseIcon size={18} />
					)}
				</Button>

				<button
					type="button"
					onClick={onStopRecording}
					title={t("recording.stop")}
					aria-label={t("recording.stop")}
					className={`${styles.recBtn} ${styles.electronNoDrag}`}
				>
					<span className={styles.stopSquare} />
				</button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onHideHud}
					title={t("recording.hideHud")}
					aria-label={t("recording.hideHud")}
				>
					<MinusIcon size={16} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onCancelRecording}
					title={t("recording.cancel")}
					aria-label={t("recording.cancel")}
				>
					<XIcon size={18} />
				</Button>
			</>
		);
	}, [
		paused,
		microphoneEnabled,
		webcamEnabled,
		elapsed,
		onToggleMicrophone,
		onToggleWebcam,
		onPauseResume,
		onStopRecording,
		onHideHud,
		onCancelRecording,
		formatTime,
		t,
	]);

	return memoizedControls;
};

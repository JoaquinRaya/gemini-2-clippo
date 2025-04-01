import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AudioPulseComponent } from '../audio-pulse/audio-pulse.component';
import { AudioRecorder } from '../../gemini/audio-recorder';
import { CommonModule } from '@angular/common';
import { ScreenCaptureService } from '../../gemini/screen-capture.service';
import { StreamConfig, UseMediaStreamResult } from '../../gemini/types';

@Component({
    selector: 'app-control-tray',
    standalone: true,
    imports: [CommonModule, AudioPulseComponent],
    templateUrl: './control-tray.component.html',
    styleUrls: ['./control-tray.component.css'],
})
export class ControlTrayComponent implements OnDestroy {
    @Input() videoRef!: HTMLVideoElement;
    @Input() supportsVideo = false;
    @Output() private readonly onVideoStreamChange = new EventEmitter<MediaStream | null>();

    @ViewChild('renderCanvas') private readonly renderCanvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('connectButton') private readonly connectButtonRef!: ElementRef<HTMLButtonElement>;

    private readonly ngUnsubscribe = new Subject<void>();
    private readonly audioRecorder = new AudioRecorder();
    private readonly streamConfig: StreamConfig = {
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: true },
        preferCurrentTab: true,
        selfBrowserSurface: "include"
    };

    public readonly screenCaptureStream: UseMediaStreamResult;
    public activeVideoStream: MediaStream | null = null;
    public muted = true;
    public isConnected = false;
    private cancelRaF = -1;
    public inVolume = 0;

    constructor(
        public readonly screenCaptureService: ScreenCaptureService,
        private readonly cdr: ChangeDetectorRef,
    ) {
        this.screenCaptureStream = this.createScreenCaptureStream();
        this.initializeSubscriptions();
    }

    private initializeSubscriptions(): void {
        this.screenCaptureService.connected$
            .pipe(takeUntil(this.ngUnsubscribe))
            .subscribe(this.handleConnectionChange.bind(this));

        this.screenCaptureService.volume$
            .pipe(takeUntil(this.ngUnsubscribe))
            .subscribe(volume => this.inVolume = volume);

        this.screenCaptureService.stream$
            .pipe(takeUntil(this.ngUnsubscribe))
            .subscribe(this.changeActiveVideoStream.bind(this));
    }

    private handleConnectionChange(connected: boolean): void {
        this.isConnected = connected;
        if (!connected && this.connectButtonRef?.nativeElement) {
            this.connectButtonRef.nativeElement.focus();
            this.cdr.detectChanges();
        }
        if (!connected) {
            if (this.screenCaptureService.isStreaming) {
                this.screenCaptureService.stop();
                this.onVideoStreamChange.emit(null);
            }
        }
        this.handleAudioRecording();
    }

    private changeActiveVideoStream(stream: MediaStream | null): void {
        if (this.activeVideoStream !== stream) {
            this.activeVideoStream = stream;
            if (this.videoRef) {
                this.videoRef.srcObject = this.activeVideoStream;
            }
            this.initVideoStream();
        }
    }

    private handleAudioRecording(): void {
        if (this.isConnected && !this.muted) {
            this.audioRecorder
                .on('data', (base64: string) => {
                    this.screenCaptureService.sendRealtimeInput([{
                        mimeType: 'audio/pcm;rate=16000',
                        data: base64
                    }]);
                })
                .on('volume', (volume: number) => {
                    this.inVolume = volume;
                })
                .start();
        } else {
            this.audioRecorder.stop();
        }
    }

    private createScreenCaptureStream(): UseMediaStreamResult {
        return {
            isStreaming: this.screenCaptureService.isStreaming,
            start: () => this.screenCaptureService.start(),
            stop: () => this.screenCaptureService.stop()
        };
    }

    private initVideoStream(): void {
        if (this.isConnected && this.activeVideoStream) {
            this.cancelRaF = requestAnimationFrame(this.sendVideoFrame);
        }
    }

    private sendVideoFrame = (): void => {
        if (!this.screenCaptureService.isStreaming) return;

        const video = this.videoRef;
        const canvas = this.renderCanvasRef?.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!video || !canvas || !ctx) return;

        canvas.width = video.videoWidth * 0.25;
        canvas.height = video.videoHeight * 0.25;

        if (canvas.width + canvas.height > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL('image/jpeg', 1.0);
            const data = base64.slice(base64.indexOf(',') + 1, Infinity);
            this.screenCaptureService.sendRealtimeInput([{ mimeType: 'image/jpeg', data }]);
        }
        if (this.isConnected) {
            setTimeout(this.sendVideoFrame, 1000 / 0.5);
        }
    };

    public async connectToggle(): Promise<void> {
        if (this.isConnected) {
            this.handleDisconnect();
        } else {
            await this.handleConnect();
        }
    }

    private handleDisconnect(): void {
        this.screenCaptureService.stop();
        this.onVideoStreamChange.emit(null);
        this.muted = true;
        this.handleAudioRecording();
    }

    private async handleConnect(): Promise<void> {
        if (!this.screenCaptureService.isStreaming) {
            const stream = await this.screenCaptureService.start();
            this.onVideoStreamChange.emit(stream);
        }
        this.muted = false;
        this.handleAudioRecording();
    }

    public ngOnDestroy(): void {
        this.ngUnsubscribe.next();
        this.ngUnsubscribe.complete();
        this.audioRecorder
            .off('data')
            .off('volume')
            .stop();
    }
}
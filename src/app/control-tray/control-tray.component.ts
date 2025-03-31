import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { AudioPulseComponent } from '../audio-pulse/audio-pulse.component';
import { AudioRecorder } from '../../gemini/audio-recorder';
// import { MultimodalLiveService } from '../../gemini/gemini-client.service';
import { CommonModule } from '@angular/common';
import { ScreenCaptureService } from '../../gemini/screen-capture.service';

//Interface for the result of your stream hooks
interface UseMediaStreamResult {
  isStreaming: boolean;
  start: () => Promise<MediaStream | null>;
  stop: () => void;
}

@Component({
  selector: 'app-control-tray',
  imports: [CommonModule, AudioPulseComponent],
  templateUrl: './control-tray.component.html',
  styleUrls: ['./control-tray.component.css'],
})
export class ControlTrayComponent
  implements OnInit, OnDestroy {

  @Input() videoRef!: HTMLVideoElement; // Make sure to pass the video element!
  @Input() supportsVideo: boolean = false;
  @Output() onVideoStreamChange = new EventEmitter<MediaStream | null>();

  @ViewChild('renderCanvas') renderCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('connectButton') connectButtonRef!: ElementRef<HTMLButtonElement>;

  screenCaptureStream: UseMediaStreamResult;

  activeVideoStream: MediaStream | null = null;
  audioRecorder: AudioRecorder = new AudioRecorder();

  muted: boolean = true;
  inVolume: number = 0;
  isConnected: boolean = false;
  cancelRaF: number = -1;

  private ngUnsubscribe = new Subject<void>(); // Used to unsubscribe from observables

  @Input()
  get volume(): number { return this.inVolume; }
  set volume(number: number) {
    this.inVolume = number;
    document.documentElement.style.setProperty(
      '--volume',
      `${Math.max(5, Math.min(this.inVolume * 200, 8))}px`,
    );
  }

  constructor(
    // private multimodalLiveService: MultimodalLiveService,
    public screenCaptureService: ScreenCaptureService,
    private cdr: ChangeDetectorRef,
  ) {
    this.screenCaptureStream = this.createScreenCaptureStream();
  }

  ngOnInit(): void {
    this.screenCaptureService.connected$
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((connected) => {
        this.isConnected = connected;
        if (!connected && this.connectButtonRef?.nativeElement) {
          this.connectButtonRef.nativeElement.focus();
          this.cdr.detectChanges(); // Trigger change detection after focus
        }
        if (!connected) {
          if (this.screenCaptureService.isStreaming) {
            this.screenCaptureService.stop();
            this.onVideoStreamChange.emit(null);
          }
        }
        this.handleAudioRecording();
      });
    this.screenCaptureService.volume$
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((volume) => {
        this.inVolume = volume;
      });

    this.screenCaptureService.stream$
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((stream) => {
        this.changeActiveVideoStream(stream);
      });
  }

  changeActiveVideoStream(stream: MediaStream | null) {
    if (this.activeVideoStream != stream) {
      this.activeVideoStream = stream;
      if (this.videoRef) {
        this.videoRef.srcObject = this.activeVideoStream;
      }
      this.initVideoStream();
    }
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next(); // Unsubscribe from all subscriptions
    this.ngUnsubscribe.complete(); // Complete the Subject
    this.audioRecorder
      .off('data')
      .off('volume')
      .stop();
  }

  handleAudioRecording() {
    if (this.isConnected && !this.muted) {
      this.audioRecorder
        .on('data', (base64: string) => {
          this.screenCaptureService.sendRealtimeInput([{
            mimeType: 'audio/pcm;rate=16000',
            data: base64
          }]);
          //console.log(`[Audio]: Stream going out`, base64);
        })
        .on('volume', (volume: number) => {
          this.inVolume = volume;
        })
        .start();
    } else {
      this.audioRecorder.stop();
    }
  }

  createScreenCaptureStream(): UseMediaStreamResult {
    return {
      isStreaming: this.screenCaptureService.isStreaming,
      start: () => this.screenCaptureService.start(),
      stop: () => this.screenCaptureService.stop()
    };
  }

  // Initial video stream setup
  private initVideoStream(): void {
    if (this.isConnected && this.activeVideoStream) {
      this.cancelRaF = requestAnimationFrame(this.sendVideoFrame);
    }
  }

  async connectToggle(): Promise<void> {
    if (this.isConnected) {
      this.screenCaptureService.stop();
      this.onVideoStreamChange.emit(null);

      this.muted = true;
      this.handleAudioRecording();
    } else {
      if (!this.screenCaptureService.isStreaming) {
        let stream = await this.screenCaptureService.start();
        this.onVideoStreamChange.emit(stream);
      };
      this.muted = false;
      this.handleAudioRecording();
    }
  }

  private sendVideoFrame = () => {
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
      //console.log(`[sendVideoFrame]: Stream going out`, data);
    }
    if (this.isConnected) {
      setTimeout(this.sendVideoFrame, 1000 / 0.5);
    }
  };
}
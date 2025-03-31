import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';

interface UseMediaStreamResult {
    isStreaming: Observable<boolean>;
    start: () => Promise<MediaStream | null>;
    stop: () => void;
}

@Injectable({
    providedIn: 'root'
})
export class ScreenCaptureService implements OnDestroy {
    private streamSubject = new BehaviorSubject<MediaStream | null>(null);
    stream$ = this.streamSubject.asObservable();
    private isStreamingSubject = new BehaviorSubject<boolean>(false);
    isStreaming$ = this.isStreamingSubject.asObservable();
    private ngUnsubscribe = new Subject<void>();

    constructor() {
        this.stream$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(stream => {
            if (stream) {
                const handleStreamEnded = () => {
                    this.isStreamingSubject.next(false);
                    this.streamSubject.next(null);
                };
                console.log("Tracks: " + stream.getTracks());
                stream.getTracks().forEach(track => {
                    track.addEventListener('ended', handleStreamEnded);
                    // Store the original stop method so we can call it later
                    const originalStop = track.stop;
                    track.stop = () => {
                        originalStop.apply(track);
                        handleStreamEnded();
                    };
                });
            }
        });
    }

    ngOnDestroy(): void {
        this.ngUnsubscribe.next();
        this.ngUnsubscribe.complete();
        this.stop();
    }

    get isStreaming() {
        return this.isStreamingSubject.value;
    }

    start(): Promise<MediaStream | null> {
        
        return (navigator.mediaDevices as any).getDisplayMedia({ video: {
            displaySurface: "browser",
          },
          audio: {
            suppressLocalAudioPlayback: true,
          },
          preferCurrentTab: true, // Hint to pre-select the current tab if possible
          selfBrowserSurface: "include", // Include the current tab in the list
        })
            .then((mediaStream: MediaStream | null) => {
                this.streamSubject.next(mediaStream);
                this.isStreamingSubject.next(true);
                return mediaStream;
            })
            .catch((error: any) => {
                console.error('Error starting screen capture:', error);
                this.isStreamingSubject.next(false);
                return null;
            });
    }

    stop(): void {
        const stream = this.streamSubject.value;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            this.streamSubject.next(null);
            this.isStreamingSubject.next(false);
        }
    }
}
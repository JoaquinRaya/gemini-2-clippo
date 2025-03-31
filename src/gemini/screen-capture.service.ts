import { Injectable, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, takeUntil } from 'rxjs';
import { MultimodalLiveService } from '../gemini/gemini-client.service';
import { LiveConfig, ModelTurn, TurnComplete } from '../gemini/types';
import { Part } from '@google/generative-ai';

interface UseMediaStreamResult {
    isStreaming: Observable<boolean>;
    start: () => Promise<MediaStream | null>;
    stop: () => void;
}

export type ChatMessage = {
    role: string;
    text: string;
  }

@Injectable({
    providedIn: 'root'
})
export class ScreenCaptureService implements OnInit, OnDestroy {
    private streamSubject = new BehaviorSubject<MediaStream | null>(null);
    stream$ = this.streamSubject.asObservable();
    private isStreamingSubject = new BehaviorSubject<boolean>(false);
    isStreaming$ = this.isStreamingSubject.asObservable();
    private ngUnsubscribe = new Subject<void>();

    connected$: Observable<boolean>;
    isConnected: boolean = false;
    volume: number = 0;
    streamedMessage: string = '';
    messages: ChatMessage[] = [];
    private connectedSubscription: Subscription | undefined;
    private contentSubscription: Subscription | undefined;

    constructor(private multimodalLiveService: MultimodalLiveService) {
        this.connected$ = this.multimodalLiveService.connected$;
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
    ngOnInit(): void {
        this.connectedSubscription = this.multimodalLiveService.connected$.subscribe(
          (connected) => {
            console.log('Connected:', connected);
            this.isConnected = connected;
          },
        );
        this.contentSubscription = this.multimodalLiveService.content$.subscribe(
          (data) => {
            if (!data) return;
            let turn = data as ModelTurn;
            let turnComplete = (data as TurnComplete).turnComplete;
            if (turn) {
              if (this.streamedMessage.length > 0) {
                this.messages.pop();
              }
              let incomingMessage = turn.modelTurn.parts?.[0]?.text as string;
              if (incomingMessage) {
                this.streamedMessage += incomingMessage;
                this.messages.push({
                  role: 'model',
                  text: this.streamedMessage
                });
              }
            }
            if (turnComplete) {
              this.messages.push({
                role: 'model',
                text: this.streamedMessage
              });
              this.streamedMessage = '';
            }
          },
        );
      }
    

    ngOnDestroy(): void {
        this.ngUnsubscribe.next();
        this.ngUnsubscribe.complete();
        this.stop();

        if (this.connectedSubscription) {
            this.connectedSubscription.unsubscribe();
            console.log('Connected:', this.isConnected);
          }
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

    connect(): void {
        let config : LiveConfig = {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            // responseModalities: "text",
            responseModalities: "audio", // note "audio" doesn't send a text response over
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
            },
          },
          systemInstruction: {
            parts: [
              {
                text: 'You are a helpful assistant.',
              },
            ],
          },
        };
    
        this.multimodalLiveService.connect(config).catch(err => {
          console.error("Failed to connect:", err);
        });
      }
    
      disconnect(): void {
        this.multimodalLiveService.disconnect();
      }
      // send(): void {
      send(message: string): void {
        this.streamedMessage = ''; // reset streamed message
        // let message = (this.chatForm.value?.message as string)?.trim();
        if (!message) return;
        let part: Part | Part[] = {
          text: message,
        };
        this.multimodalLiveService.send(part);
        this.messages.push({
          role: 'user',
          text: message
        });
        // this.chatForm.reset();
      }
}
import { Injectable, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, takeUntil } from 'rxjs';
import { Interrupted, LiveConfig, ModelTurn, ServerContent, StreamingLog, TurnComplete } from '../gemini/types';
import { Part } from '@google/generative-ai';
import {
    MultimodalLiveAPIClientConnection,
    MultimodalLiveClient,
} from './ws-client';
import { environment } from '../../src/environments/environment.development';
import { AudioStreamer } from './audio-streamer';
import VolMeterWorket from './worklet.vol-meter';
import { audioContext } from './utils';
import { GenerativeContentBlob } from '@google/generative-ai';
type ServerContentNullable = ModelTurn | TurnComplete | Interrupted | null;


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

    private connectedSubject = new BehaviorSubject<boolean>(false);
    connected$ = this.connectedSubject.asObservable();
    isConnected: boolean = false;
    volume: number = 0;
    streamedMessage: string = '';
    
    private contentSubject = new BehaviorSubject<ServerContentNullable>(null);
    content$ = this.contentSubject.asObservable();

    public wsClient: MultimodalLiveClient;
    private audioStreamer: AudioStreamer | null = null;
    private volumeSubject = new BehaviorSubject<number>(0);
    volume$ = this.volumeSubject.asObservable();
    private destroy$ = new Subject<void>(); // For unsubscribing
    
    public config: LiveConfig = {
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
        tools: [
            { googleSearch: {} },
            { codeExecution: {} },
        ],
    };

    constructor() {
        const connectionParams: MultimodalLiveAPIClientConnection = {
            url: environment.WS_URL,
            apiKey: environment.API_KEY,
        };
        this.wsClient = new MultimodalLiveClient(connectionParams);
        this.initializeAudioStreamer();
        this.setupEventListeners();

        this.stream$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(stream => {
            if (stream) {
                const handleStreamEnded = () => {
                    this.isStreamingSubject.next(false);
                    this.streamSubject.next(null);
                };
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

    
    private setupEventListeners(): void {
        this.wsClient
            .on('open', () => {
                console.log('WS connection opened');
            })

            .on('log', (log: StreamingLog) => {
                //console.log(log);
            })
            .on('content', (data: ServerContent) => {
                this.contentSubject.next(data);
                console.log("Received data on screencaptureservice setupeventlisteners" + data);
            })
            .on('close', (e: CloseEvent) => {
                console.log('WS connection closed', e);
                this.setConnected(false);
            });

        // audio event listeners
        this.wsClient
            .on('interrupted', () => {
                this.stopAudioStreamer()
            })
            .on('audio', (data: ArrayBuffer) => {
                this.addAudioData(data);
            });
    }
    ngOnInit(): void {

    }

    ngOnDestroy(): void {
        this.ngUnsubscribe.next();
        this.ngUnsubscribe.complete();
        this.stop();

        this.destroy$.next();
        this.destroy$.complete();
    }

    get isStreaming() {
        return this.isStreamingSubject.value;
    }

    async start(): Promise<MediaStream | null> {
        this.wsClient.disconnect();
        try {
            await this.wsClient.connect(this.config);
            this.setConnected(true);
        } catch (error) {
            console.error('Connection error:', error);
            this.setConnected(false); // Ensure state is updated on error
            throw error; // Re-throw to allow component to handle
        }

        return (navigator.mediaDevices as any).getDisplayMedia({
            video: {
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
        this.wsClient.disconnect();
        this.stopAudioStreamer(); // Stop audio on disconnect
        this.setConnected(false);

        const stream = this.streamSubject.value;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            this.streamSubject.next(null);
            this.isStreamingSubject.next(false);
        }
    }
    async send(message: any): Promise<any> {
        if (!this.isConnected) {
            throw new Error('Not connected to Gemini. Please connect first.');
        }
        
        this.streamedMessage = ''; // reset streamed message
        if (!message) return;
        
        let part: Part | Part[] = {
            text: message,
        };

        this.wsClient.send(part);
    }
    
    async sendRealtimeInput(chunks: GenerativeContentBlob[]): Promise<any> {
        this.wsClient.sendRealtimeInput(chunks);
    }

    private async initializeAudioStreamer(): Promise<void> {
        try {
            const audioCtx = await audioContext({ id: 'audio-out' });
            this.audioStreamer = new AudioStreamer(audioCtx);
            await this.audioStreamer.addWorklet<any>(
                'vumeter-out',
                VolMeterWorket,
                (ev: any) => {
                    this.volumeSubject.next(ev.data.volume);
                },
            );
        } catch (error) {
            console.error('Error initializing audio streamer:', error);
            // Handle error appropriately (e.g., disable audio features)
        }
    }
    private stopAudioStreamer(): void {
        if (this.audioStreamer) {
            this.audioStreamer.stop();
        }
    }

    private addAudioData(data: ArrayBuffer): void {
        if (this.audioStreamer) {
            this.audioStreamer.addPCM16(new Uint8Array(data));
        }
    }
    private setConnected(connected: boolean): void {
        this.isConnected = connected;
        this.connectedSubject.next(connected);
    }

    
}
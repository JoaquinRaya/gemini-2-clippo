import { Injectable, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, takeUntil } from 'rxjs';
import { Interrupted, LiveConfig, ModelTurn, ServerContent, StreamingLog, ToolCall, TurnComplete } from './types';
import { GoogleGenerativeAI, Part, SchemaType, Tool } from '@google/generative-ai';
import {
    MultimodalLiveAPIClientConnection,
    MultimodalLiveClient,
} from './ws-client';
import { environment } from '../environments/environment.development';
import { AudioStreamer } from './audio-streamer';
import VolMeterWorket from './worklet.vol-meter';
import { audioContext } from './utils';
import { GenerativeContentBlob } from '@google/generative-ai';
type ServerContentNullable = ModelTurn | TurnComplete | Interrupted | null;
type ToolCallNullable = ToolCall | null;

export type ChatMessage = {
    role: string;
    text: string;
}

// Coming from Claude
interface ImageCapture {
    takePhoto(): Promise<Blob>;
    grabFrame(): Promise<ImageBitmap>;
}
interface ImageCaptureConstructor {
    new(track: MediaStreamTrack): ImageCapture;
}
declare global {
    interface Window {
        ImageCapture: ImageCaptureConstructor;
    }
}

@Injectable({
    providedIn: 'root'
})
export class ClippoService implements OnInit, OnDestroy {
    private streamSubject = new BehaviorSubject<MediaStream | null>(null);
    stream$ = this.streamSubject.asObservable();
    private screenStream: MediaStream | null = null;
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

    private toolSubject = new BehaviorSubject<ToolCallNullable>(null);
    tool$ = this.toolSubject.asObservable();

    public wsClient: MultimodalLiveClient;
    private audioStreamer: AudioStreamer | null = null;
    private volumeSubject = new BehaviorSubject<number>(0);
    volume$ = this.volumeSubject.asObservable();
    private destroy$ = new Subject<void>(); // For unsubscribing

    private cursorPositionSubject = new BehaviorSubject<{x: number, y: number} | null>(null);
    cursorPosition$ = this.cursorPositionSubject.asObservable();

    // Tools
    private toolObject: Tool[] = [
        {
            functionDeclarations: [
                {
                    name: "move_cursor_sequence",
                    description:
                        "Moves the cursor through a sequence of points on the screen with specified delays between movements.",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            points: {
                                type: SchemaType.ARRAY,
                                description: "List of points to move to with their delays",
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        description: {
                                            type: SchemaType.STRING,
                                            description:
                                                "Detailed description of what to point to on the screen, like 'the login button in the top right' or 'the settings icon that looks like a gear'",
                                        },
                                        delay: {
                                            type: SchemaType.NUMBER,
                                            description:
                                                "Time to wait in seconds AFTER the previous point before moving to this point. For the first point, use 0 to move immediately.",
                                        },
                                    },
                                    required: ["description", "delay"],
                                },
                            },
                        },
                        required: ["points"],
                    },
                },
            ],
        },
    ];
    //System instructions
    private systemInstructionObject = {
        parts: [
            {
                text: `
  You are a helpful assistant that can move your cursor to different locations on the screen in a choreographed sequence.
  
  Your cursor is visually distinct from the default system cursor.
  
  You will respond in speech naturally while moving your cursor in an intuitive sequence through relevant points on the screen.
  When moving through points, you should describe what you're pointing to in a natural conversational way.
  
  Timing Guidelines:
  - Calculate delays based on the natural speech between points
  - Use approximately 1 second for every 3 words you plan to speak
  - Minimum delay between points should be 2 seconds
  - Maximum delay between points should be 8 seconds
  - First point should always have 0 delay (immediate)
  
  Example speech:
  "Let me show you the main features. Here in the top-left is the menu button, and if we move over here you'll see the settings panel, and finally this is where your profile information appears."
  
  Timing breakdown for the example:
  1. "Here in the top-left is the menu button" (8 words ≈ 3s)
  2. "and if we move over here you'll see the settings panel" (12 words ≈ 4s)
  3. "and finally this is where your profile information appears" (10 words ≈ 3s)
  
  This would translate to delays of [0, 3, 4, 3] seconds between points.
  
  Do not use mechanical phrases like:
  - "I've moved the cursor to X"
  - "Now I'm pointing at Y"
  - "The cursor is now at Z"
  - "Is there anything else I can help you with?"
  - "Let me know if you need anything else"
  
  Remember that you should proactively move your cursor when it helps explain or demonstrate something, without being explicitly asked to do so.
  
  Always maintain natural conversation even when executing cursor movements. Keep the timing natural and match it to your speech rhythm.

  Currently you are showing a small chat application that allows a user to talk to an LLM model. It has an input box in the middle where the user can type their message, on top of the input box you will get the outputs and to the right there is a send button that will send the message to the model. At the top of the screen there is some text that shows your connection status
  `,
            },
        ],
    };

    public config: LiveConfig = {
        model: "models/gemini-2.0-flash-exp",
        generationConfig: {
            // responseModalities: "text",
            responseModalities: "audio", // note "audio" doesn't send a text response over
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
            },
        },
        systemInstruction: this.systemInstructionObject,
        tools: this.toolObject,
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

    async getPointsFromImage(
        base64Image: string,
        points: { description: string; delay: number }[]
    ) {
        const genAI = new GoogleGenerativeAI(environment.API_KEY);
        const model = genAI.getGenerativeModel({
            model: "models/gemini-2.0-flash-exp",
        });

        const results = await Promise.all(
            points.map(async ({ description }) => {
                const prompt = `Find the location of: "${description}". The answer should follow the json format: {"point": <point>, "label": <label1>}. The point should be in [y, x] format normalized to 0-1000. Return only one point that best matches the description. Do not wrap the JSON in markdown quotes. Just return the JSON string.`;

                // Remove the data URL prefix if it exists
                const imageData = base64Image.includes("data:image")
                    ? base64Image.slice(base64Image.indexOf(",") + 1)
                    : base64Image;

                const result = await model.generateContent([
                    {
                        inlineData: {
                            data: imageData,
                            mimeType: "image/jpeg",
                        },
                    },
                    prompt,
                ]);

                const text = result.response.text();

                return JSON.parse(text);
            })
        );

        return results;
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
            .on('toolcall', (data: ToolCallNullable) => {
                this.toolSubject.next(data);
                console.log(data);
                this.handleMoveCursorInSequence(data);
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
    async handleMoveCursorInSequence(toolCall: any) {
        if (!toolCall) return;
        const functionCalls = toolCall.functionCalls;
        console.log("functionCalls", functionCalls);

        if (
            functionCalls.length > 0 &&
            functionCalls[0].name === "move_cursor_sequence"
        ) {
            
            const { points } = functionCalls[0].args;

            if (points.length > 0 && this.screenStream) {
                const lastCapturedFrame = await this.captureLastFrame(this.screenStream);
                const locations = await this.getPointsFromImage(lastCapturedFrame, points);
                console.log("locations", locations);

                // Calculate cumulative delays (convert from seconds to milliseconds)
                let cumulativeDelay = 0;
                for (let i = 0; i < locations.length; i++) {
                    const point = Array.isArray(locations[i])
                        ? locations[i][0]
                        : locations[i].point;
                    console.log("point", point);

                    // Current point's delay is added to cumulative
                    cumulativeDelay += points[i].delay * 1000; // Convert to milliseconds

                    if (point) {
                        const [y, x] = point;
                        // Schedule the cursor movement at the cumulative delay
                        setTimeout(() => {
                            this.raiseMoveCursorEvent(x, y);
                        }, cumulativeDelay);
                    }
                }
            }
        }
    }
    private raiseMoveCursorEvent(x: number, y: number) {
        this.cursorPositionSubject.next({
            x: x,
            y: y
        });
    }
    
async captureLastFrame(stream: MediaStream): Promise<string> {
    try {
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
            throw new Error("No video track found in stream");
        }

        // Create video element
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;

        // Wait for video to be ready
        await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });

        // Create canvas with video dimensions
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw current video frame to canvas
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error("Could not get canvas context");
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert to base64
        const base64Image = canvas.toDataURL('image/jpeg', 0.95);

        // Cleanup
        video.pause();
        video.srcObject = null;
        
        return base64Image;
    } catch (error) {
        console.error("Error capturing frame:", error);
        throw error;
    }
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
                this.screenStream = mediaStream;
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
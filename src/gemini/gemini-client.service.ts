// import { Injectable, OnDestroy } from '@angular/core';
// import { BehaviorSubject, Subject } from 'rxjs';
// // import {
// //   MultimodalLiveAPIClientConnection,
// //   MultimodalLiveClient,
// // } from './ws-client';
// import { Interrupted, LiveConfig, ModelTurn, ServerContent, StreamingLog, ToolCall, ToolCallCancellation, TurnComplete } from './types';
// // import { environment } from '../../src/environments/environment.development';

// // import { AudioStreamer } from './audio-streamer'; 
// // import VolMeterWorket from './worklet.vol-meter'; 
// // import { audioContext } from './utils'; 
// // import { GenerativeContentBlob } from '@google/generative-ai';


// type ServerContentNullable = ModelTurn | TurnComplete | Interrupted | null;
// type ToolCallNullable = ToolCall | null;

// @Injectable({
//   providedIn: 'root',
// })
// export class MultimodalLiveService implements OnDestroy {
//   // public wsClient: MultimodalLiveClient;
//   // private connectedSubject = new BehaviorSubject<boolean>(false);
//   // connected$ = this.connectedSubject.asObservable();
//   private contentSubject = new BehaviorSubject<ServerContentNullable>(null);
//   content$ = this.contentSubject.asObservable();
  
//   // public config : LiveConfig = {
//   //   model: "models/gemini-2.0-flash-exp",
//   //   generationConfig: {
//   //     // responseModalities: "text",
//   //     responseModalities: "audio", // note "audio" doesn't send a text response over
//   //     speechConfig: {
//   //       voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
//   //     },
//   //   },
//   //   systemInstruction: {
//   //     parts: [
//   //       {
//   //         text: 'You are a helpful assistant.',
//   //       },
//   //     ],
//   //   },
//   //   tools: [
//   //     { googleSearch: {} }, 
//   //     { codeExecution: {} },
//   //   ],
//   // };
//   // private audioStreamer: AudioStreamer | null = null;
//   // private volumeSubject = new BehaviorSubject<number>(0);
//   // volume$ = this.volumeSubject.asObservable();
//   // private destroy$ = new Subject<void>(); // For unsubscribing

//   // constructor() {
//   //   const connectionParams: MultimodalLiveAPIClientConnection = {
//   //     url: environment.WS_URL,
//   //     apiKey: environment.API_KEY,
//   //   };
//   //   this.wsClient = new MultimodalLiveClient(connectionParams);
//   //   this.initializeAudioStreamer();
//   //   this.setupEventListeners();
//   // }

//   // ngOnDestroy(): void {
//   //   this.destroy$.next();
//   //   this.destroy$.complete();
//   //   this.disconnect(); // Ensure disconnection on service destruction
//   // }

//   // private async initializeAudioStreamer(): Promise<void> {
//   //   try {
//   //     const audioCtx = await audioContext({ id: 'audio-out' });
//   //     this.audioStreamer = new AudioStreamer(audioCtx);
//   //     await this.audioStreamer.addWorklet<any>(
//   //       'vumeter-out',
//   //       VolMeterWorket,
//   //       (ev: any) => {
//   //         this.volumeSubject.next(ev.data.volume);
//   //       },
//   //     );
//   //   } catch (error) {
//   //     console.error('Error initializing audio streamer:', error);
//   //     // Handle error appropriately (e.g., disable audio features)
//   //   }
//   // }

//   // private setupEventListeners(): void {
//   //   this.wsClient
//   //     .on('open', () => {
//   //       console.log('WS connection opened');
//   //     })

//   //     .on('log', (log: StreamingLog) => {
//   //       console.log(log);
//   //     })
//   //     .on('content', (data: ServerContent) => {
//   //       this.contentSubject.next(data);
//   //       console.log(data);
//   //     })
//   //     .on('toolcall', (data: ToolCallNullable) => {
//   //       this.toolSubject.next(data);
//   //       console.log(data);
//   //     })

//   //     .on('close', (e: CloseEvent) => {
//   //       console.log('WS connection closed', e);
//   //       this.setConnected(false);
//   //     });
    
//   //   // audio event listeners
//   //   this.wsClient
//   //     .on('interrupted', () => {
//   //     this.stopAudioStreamer() })
//   //     .on('audio', (data: ArrayBuffer) => {
//   //     this.addAudioData(data);
//   //   });
//   // }

//   // private stopAudioStreamer(): void {
//   //   if (this.audioStreamer) {
//   //     this.audioStreamer.stop();
//   //   }
//   // }

//   // private addAudioData(data: ArrayBuffer): void {
//   //   if (this.audioStreamer) {
//   //     this.audioStreamer.addPCM16(new Uint8Array(data));
//   //   }
//   // }
  
//   // async connect(config: LiveConfig = this.config): Promise<void> {
//   //   this.wsClient.disconnect();
//   //   try {
//   //     await this.wsClient.connect(config);
//   //     this.setConnected(true);
//   //   } catch (error) {
//   //     console.error('Connection error:', error);
//   //     this.setConnected(false); // Ensure state is updated on error
//   //     throw error; // Re-throw to allow component to handle
//   //   }
//   // }

//   // disconnect(): void {
//   //   this.wsClient.disconnect();
//   //   this.stopAudioStreamer(); // Stop audio on disconnect
//   //   this.setConnected(false);
//   // }

//   // private setConnected(connected: boolean): void {
//   //   this.connectedSubject.next(connected);
//   // }

//   // async send(message: any): Promise<any> {
//   //   this.wsClient.send(message);
//   // }
  

//   // async sendRealtimeInput(chunks: GenerativeContentBlob[]): Promise<any> {
//   //   this.wsClient.sendRealtimeInput(chunks);
//   // }

// }
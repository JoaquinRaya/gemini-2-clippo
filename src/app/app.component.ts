import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ControlTrayComponent } from './control-tray/control-tray.component';
import { ChatMessage, ScreenCaptureService } from '../gemini/screen-capture.service'
import { ModelTurn, TurnComplete } from '../gemini/types';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  imports: [CommonModule, ReactiveFormsModule, ControlTrayComponent],
})

export class AppComponent implements OnInit {
  @ViewChild('myVideo') myVideoRef!: ElementRef<HTMLVideoElement>;

  title = 'gemini-2-live-angular';
  isConnected: boolean = false;
  // volume: number = 0;
  streamedMessage: string = '';
  messages: ChatMessage[] = [];
  private connectedSubscription: Subscription | undefined;
  private contentSubscription: Subscription | undefined;

  chatForm = new FormGroup({
    message: new FormControl('Write a poem.'),
  });
  isFormEmpty: boolean = this.chatForm.value?.message?.length === 0;

  ngOnInit(): void {
    this.connectedSubscription = this.screenCaptureService.connected$.subscribe(
      (connected) => {
        console.log('Connected:', connected);
        this.isConnected = connected;
      },
    );
      this.contentSubscription = this.screenCaptureService.content$.subscribe(
      (data) => {
        if (!data) return;
        console.log('Received data on app.component:', data);
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

  send(): void {
    this.streamedMessage = ''; // reset streamed message
    let message = (this.chatForm.value?.message as string)?.trim();
    if (!message) return;

    this.screenCaptureService.send(message);
    this.messages.push({
      role: 'user',
      text: message
    });
    this.chatForm.reset();
  }

  // constructor(private multimodalLiveService: MultimodalLiveService) { }
  constructor(private screenCaptureService: ScreenCaptureService) { }
 
  reset(): void {
    this.chatForm.reset();
  }

  handleVideoStreamChange(stream: MediaStream | null) {
    // Handle the video stream change here (e.g., update the video element)
    if (this.myVideoRef) {
      this.myVideoRef.nativeElement.srcObject = stream;
    }
  }
}
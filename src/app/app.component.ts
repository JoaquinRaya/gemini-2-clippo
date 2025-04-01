import { Component, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ControlTrayComponent } from './control-tray/control-tray.component';
import { ClippoService } from '../gemini/clippo.service';
import { ChatMessage } from '../gemini/types';
import { ModelTurn, TurnComplete } from '../gemini/types';

interface ChatForm {
    message: FormControl<string | null>;
}

@Component({
    selector: 'app-root',
    standalone: true,
    templateUrl: './app.component.html',
    imports: [CommonModule, ReactiveFormsModule, ControlTrayComponent],
})
export class AppComponent implements OnInit, OnDestroy {
    @ViewChild('myVideo') private readonly myVideoRef!: ElementRef<HTMLVideoElement>;

    public readonly title = 'gemini-2-live-angular';
    public isConnected = false;
    public streamedMessage = '';
    public messages: ChatMessage[] = [];
    public readonly chatForm = new FormGroup<ChatForm>({
        message: new FormControl('Write a poem.'),
    });
    public cursorVisible = false;

    private readonly destroy$ = new Subject<void>();

    constructor(private readonly screenCaptureService: ClippoService) {}

    public ngOnInit(): void {
        this.initializeSubscriptions();
    }

    private initializeSubscriptions(): void {
        this.screenCaptureService.connected$
            .pipe(takeUntil(this.destroy$))
            .subscribe(connected => this.isConnected = connected);

        this.screenCaptureService.content$
            .pipe(takeUntil(this.destroy$))
            .subscribe(data => this.handleContent(data as ModelTurn | TurnComplete | null));
            
        // Add cursor position subscription
        this.screenCaptureService.cursorPosition$
            .pipe(takeUntil(this.destroy$))
            .subscribe(position => {
                if (position) {
                    console.log('Proposed cursor position:', position);
                    this.moveCursorToPosition(position);
                }
            });
    }

    private handleContent(data: ModelTurn | TurnComplete | null): void {
        if (!data) return;

        const modelTurn = data as ModelTurn;
        const turnComplete = (data as TurnComplete).turnComplete;

        if (modelTurn?.modelTurn) {
            this.handleModelTurn(modelTurn);
        }

        if (turnComplete) {
            this.handleTurnComplete();
        }
    }

    public send(): void {
        const message = this.chatForm.value.message?.trim();
        if (!message) return;

        this.streamedMessage = '';
        this.screenCaptureService.send(message);
        this.messages.push({ role: 'user', text: message });
        this.chatForm.reset();
    }

    public handleVideoStreamChange(stream: MediaStream | null): void {
        if (this.myVideoRef?.nativeElement) {
            this.myVideoRef.nativeElement.srcObject = stream;
        }
    }

    public ngOnDestroy(): void {
        this.cursorVisible = false;
        this.destroy$.next();
        this.destroy$.complete();
    }

    private handleModelTurn(turn: ModelTurn): void {
        if (this.streamedMessage.length > 0) {
            this.messages.pop();
        }
        
        const incomingMessage = turn.modelTurn.parts?.[0]?.text;
        if (incomingMessage) {
            this.streamedMessage += incomingMessage;
            this.messages.push({
                role: 'model',
                text: this.streamedMessage
            });
        }
    }

    private handleTurnComplete(): void {
        this.messages.push({
            role: 'model',
            text: this.streamedMessage
        });
        this.streamedMessage = '';
    }

    private moveCursorToPosition(position: { x: number; y: number }) {
        // Convert normalized coordinates (0-1000) to viewport coordinates
        const viewportX = (position.x / 1000) * window.innerWidth;
        const viewportY = (position.y / 1000) * window.innerHeight;
        
        const cursor = document.getElementById('ai-cursor');
        if (cursor) {
            cursor.style.left = `${viewportX}px`;
            cursor.style.top = `${viewportY}px`;
            this.cursorVisible = true;
        }
    }
}





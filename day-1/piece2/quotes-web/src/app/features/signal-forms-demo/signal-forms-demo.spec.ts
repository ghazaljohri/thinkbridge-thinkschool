import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SignalFormsDemo } from './signal-forms-demo';
import { API_BASE_URL } from '../../core/api-base-url';

describe('SignalFormsDemo', () => {
  let fixture: ComponentFixture<SignalFormsDemo>;
  let component: SignalFormsDemo;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignalFormsDemo],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SignalFormsDemo);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the last created quote once the embedded form emits one', () => {
    component.onCreated({ id: 1, author: 'Ada Lovelace', text: 'Hi', isDeleted: false, createdAtUtc: 'x' });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ada Lovelace');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthorsSummary } from './authors-summary';
import { API_BASE_URL } from '../../../core/api-base-url';

describe('AuthorsSummary', () => {
  let component: AuthorsSummary;
  let fixture: ComponentFixture<AuthorsSummary>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorsSummary],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthorsSummary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should create', async () => {
    httpMock.expectOne('http://api.test/api/authors/summary').flush([]);
    await fixture.whenStable();
    expect(component).toBeTruthy();
  });

  it('renders the author summaries returned by the API', async () => {
    httpMock.expectOne('http://api.test/api/authors/summary').flush([
      { author: 'Ada Lovelace', quoteCount: 2, mostRecentQuoteText: 'Latest quote' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('2 quotes');
    expect(text).toContain('Latest quote');
  });

  it('falls back to the empty state when there are no authors', async () => {
    httpMock.expectOne('http://api.test/api/authors/summary').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No authors yet.');
  });
});

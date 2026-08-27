import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { QuoteDetail } from './quote-detail';
import { API_BASE_URL } from '../../../core/api-base-url';
import { errorMappingInterceptor } from '../../../core/http/error-mapping-interceptor';

describe('QuoteDetail', () => {
  let fixture: ComponentFixture<QuoteDetail>;
  let component: QuoteDetail;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuoteDetail],
      providers: [
        // Quotes.loadDetail() opts into MAP_ERRORS - without this
        // interceptor registered here too, `error` in its subscribe()
        // stays a raw HttpErrorResponse and detailError() shows its
        // generic .message instead of the friendly AppError one.
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuoteDetail);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests the real detail endpoint for the bound id and renders it on success', async () => {
    fixture.componentRef.setInput('id', '5');
    fixture.detectChanges();

    const req = httpMock.expectOne('http://api.test/api/quotes/5');
    req.flush({
      id: 5,
      author: 'Grace Hopper',
      text: 'It is easier to ask forgiveness than it is to get permission.',
      isDeleted: false,
      createdAtUtc: '2026-01-01',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Grace Hopper');
    expect(text).toContain('forgiveness');
  });

  it('shows a friendly message on a 404, not a raw error or a blank page', async () => {
    fixture.componentRef.setInput('id', '999');
    fixture.detectChanges();

    httpMock
      .expectOne('http://api.test/api/quotes/999')
      .flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('That could not be found.');
  });

  it('re-fetches without remounting when the bound id changes to a different quote', async () => {
    fixture.componentRef.setInput('id', '1');
    fixture.detectChanges();
    httpMock
      .expectOne('http://api.test/api/quotes/1')
      .flush({ id: 1, author: 'Ada Lovelace', text: 'Q1', isDeleted: false, createdAtUtc: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentRef.setInput('id', '2');
    fixture.detectChanges();
    httpMock
      .expectOne('http://api.test/api/quotes/2')
      .flush({ id: 2, author: 'Grace Hopper', text: 'Q2', isDeleted: false, createdAtUtc: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Grace Hopper');
    expect(text).not.toContain('Ada Lovelace');
  });

  it('shows a clear message instead of a blank page for a non-numeric id', () => {
    fixture.componentRef.setInput('id', 'not-a-number');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain("That's not a valid quote id.");
    httpMock.expectNone(() => true);
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CollectionsPage } from './collections-page';
import { API_BASE_URL } from '../../../core/api-base-url';
import { Auth } from '../../../core/auth';
import { errorMappingInterceptor } from '../../../core/http/error-mapping-interceptor';

describe('CollectionsPage', () => {
  let fixture: ComponentFixture<CollectionsPage>;
  let component: CollectionsPage;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    // sub: '1' is the real ownerId this page derives from the session -
    // the same field Collection.OwnerId/CollectionSummary.ownerId mean.
    const fakeToken = `header.${btoa(JSON.stringify({ email: 'test@example.com', sub: '1' }))}.sig`;
    localStorage.setItem(
      'quotes-web.session',
      JSON.stringify({ accessToken: fakeToken, refreshToken: 'r' }),
    );

    await TestBed.configureTestingModule({
      imports: [CollectionsPage],
      providers: [
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionsPage);
    component = fixture.componentInstance;
    TestBed.inject(Auth);
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads summaries for the signed-in userId, derived from the real sub claim', () => {
    const req = httpMock.expectOne((r) => r.url === 'http://api.test/api/collections');
    expect(req.request.params.get('ownerId')).toBe('1');
    req.flush([]);
  });

  it('selects a collection, loads its detail, and lets an item be added then removed', async () => {
    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/collections')
      .flush([{ id: 1, name: 'Favorites', ownerId: 1, itemCount: 0, lastAddedAt: null }]);
    await fixture.whenStable();
    fixture.detectChanges();

    component.select(1);
    fixture.detectChanges();
    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({ id: 1, name: 'Favorites', ownerId: 1, items: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    component.newQuoteId.set('5');
    const addPromise = component.addItem();
    const addReq = httpMock.expectOne(
      (r) => r.url === 'http://api.test/api/collections/1/items' && r.method === 'POST',
    );
    expect(addReq.request.body).toEqual({ quoteId: 5 });
    addReq.flush(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({
        id: 1,
        name: 'Favorites',
        ownerId: 1,
        items: [{ quoteId: 5, author: 'Ada Lovelace', text: 'Q1', addedAt: 'x' }],
      });
    await addPromise;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ada Lovelace');

    component.removeItem(5);
    httpMock
      .expectOne(
        (r) => r.url === 'http://api.test/api/collections/1/items/5' && r.method === 'DELETE',
      )
      .flush(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({ id: 1, name: 'Favorites', ownerId: 1, items: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No quotes in this collection yet.',
    );
  });

  it('blocks a too-short collection name client-side and shows the real error, matching Collection.ValidateName', async () => {
    httpMock.expectOne((r) => r.url === 'http://api.test/api/collections').flush([]);
    await fixture.whenStable();

    component.newName.set('ab');
    await component.createCollection();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Collection name must be between 3 and 80 characters.',
    );
    httpMock.expectNone((r) => r.method === 'POST');
  });
});

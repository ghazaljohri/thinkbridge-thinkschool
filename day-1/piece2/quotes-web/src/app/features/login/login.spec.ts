import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Login } from './login';
import { API_BASE_URL } from '../../core/api-base-url';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('navigates to /quotes after a successful login', async () => {
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.email.set('test@example.com');
    component.password.set('Password123!');
    const submitPromise = component.submit();

    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: 'a.b.c', refresh_token: 'r', expires_in: 1800 });
    await submitPromise;

    expect(navigateSpy).toHaveBeenCalledWith('/quotes');
    expect(component.errorMessage()).toBeNull();
  });

  it('shows an error message and stays put when the credentials are rejected', async () => {
    component.email.set('test@example.com');
    component.password.set('wrong');
    const submitPromise = component.submit();

    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await submitPromise;

    expect(component.errorMessage()).toBe('Invalid email or password.');
    expect(component.isSubmitting()).toBe(false);
  });
});

import { InjectionToken } from '@angular/core';

// The Week-1 API's default `dotnet run --launch-profile http` address (see
// QuotesApi/Properties/launchSettings.json). Overridden in tests via DI.
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  factory: () => 'http://localhost:5058',
});

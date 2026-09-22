import { createContext, useContext } from 'react';

export type Connections = {
  username: string;
  dorisConfigured: boolean;
  meta: 'checking' | 'authorized' | 'unauthorized' | 'unavailable';
  ownerId?: string;
  checkedAt?: string;
  refresh: () => void;
};
export const AuthorizationContext = createContext<Connections>({
  username: '',
  dorisConfigured: false,
  meta: 'checking',
  refresh: () => {},
});
export const useAuthorization = () => useContext(AuthorizationContext);

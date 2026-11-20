// must be first: provides crypto.getRandomValues for tweetnacl key generation / nonces
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);

/**
 * App entry. Background task definitions MUST be registered at module scope before the app
 * renders, so the OS can deliver background location batches even when the JS runtime is
 * (re)started headless (expo-task-manager). Then hand over to expo-router.
 */
import './src/location/background-task';
import 'expo-router/entry';

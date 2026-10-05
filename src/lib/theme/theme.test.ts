import assert from 'node:assert/strict';
import test from 'node:test';
import { THEME_COOKIE_MAX_AGE, themeAttribute, themeCookie } from './theme';

test('only an exact light or dark becomes the data-theme attribute', () => {
  assert.equal(themeAttribute('light'), 'light');
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute(undefined), null);
  assert.equal(themeAttribute(''), null);
  assert.equal(themeAttribute('system'), null);
  assert.equal(themeAttribute('Dark'), null);
  assert.equal(themeAttribute('dark" onload="x'), null);
});

test('an explicit choice is kept for a year', () => {
  assert.equal(themeCookie('dark'), `theme=dark; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`);
  assert.equal(themeCookie('light'), `theme=light; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`);
});

test('choosing system clears the cookie so CSS follows the device', () => {
  assert.equal(themeCookie('system'), 'theme=; Path=/; Max-Age=0; SameSite=Lax');
});

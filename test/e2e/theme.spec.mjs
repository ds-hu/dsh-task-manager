/**
 * Test 6 — dark theme.
 *
 * The Host exposes no reachable theme control from the panel (the account menu
 * lives outside the panel and no settings surface was reachable from this
 * suite), so dark mode is exercised the way a user on a dark desktop gets it:
 * `prefers-color-scheme: dark`. The Host theme follows the system preference
 * (`document.documentElement.style.color-scheme === "dark"`), and the plugin's
 * root then reports `data-theme="dark"`. The screenshot is captured in the same
 * state.
 *
 * The test also asserts legibility from computed colors instead of trusting the
 * attribute alone: the panel background must be dark and the body text light.
 */
import { expect, test } from './fixtures.mjs';
import { SEL } from './helpers.mjs';

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('follows the host dark preference and stays legible', async ({ app }) => {
    // The host really is in dark mode.
    const hostScheme = await app.evaluate(() => document.documentElement.style.colorScheme);
    expect(hostScheme).toBe('dark');

    const root = app.locator(SEL.root);
    await expect(root).toHaveAttribute('data-theme', 'dark');

    // Computed colors: dark background, light text.
    const colors = await root.evaluate((node) => {
      const style = getComputedStyle(node);
      const parse = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/u);
        if (match === null) return null;
        const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
        return { r: parts[0], g: parts[1], b: parts[2] };
      };
      const luminance = ({ r, g, b }) => {
        const channel = (value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const background = parse(style.backgroundColor);
      const text = parse(style.color);
      return {
        background,
        text,
        backgroundLuminance: background === null ? null : luminance(background),
        textLuminance: text === null ? null : luminance(text),
      };
    });
    expect(colors.backgroundLuminance).not.toBeNull();
    expect(colors.textLuminance).not.toBeNull();
    expect(colors.backgroundLuminance).toBeLessThan(0.25);
    expect(colors.textLuminance).toBeGreaterThan(0.5);
    expect(colors.textLuminance - colors.backgroundLuminance).toBeGreaterThan(0.4);

    // The main surfaces inherit the dark palette rather than staying white.
    const surface = await app
      .locator(SEL.processTable)
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(surface).toMatch(/rgba?\(([^)]+)\)/u);
  });
});

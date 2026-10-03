import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Register } from '@/components/proof/Register';
import { readDeployments } from '@/lib/deployments';

/** The register's cells as [contract, network, text]. */
function cells(html: string): [string, string, string][] {
  const rows = html.split('<tr>').slice(2);
  return rows.flatMap((row) => {
    const name = /<span[^>]*>([^<]+)<\/span>/.exec(row)?.[1] ?? '';
    return [...row.matchAll(/<td data-network="([^"]+)">(.*?)<\/td>/g)].map(
      (m) => [name, m[1]!, m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()] as [string, string, string],
    );
  });
}

describe('register of deployments', () => {
  const all = cells(renderToStaticMarkup(createElement(Register, { records: readDeployments() })));

  it('marks the Stylus stand-ins as not used where Stylus runs, never as deploying', () => {
    for (const name of ['Ladder stand-in (fails closed)', 'Keccak-f[1600] helper', 'ML-DSA-44 verifier (Solidity)']) {
      const row = all.filter(([n]) => n === name);
      expect(row.length).toBe(3);
      for (const [, net, text] of row) {
        if (net === 'Arbitrum One') expect(text).toMatch(/^0x/);
        else expect(text).toBe('not used on this network');
      }
    }
  });

  it('shows the live modules on both networks', () => {
    const store = all.filter(([n]) => n === 'Key store');
    expect(store.find(([, net]) => net === 'ApeChain')![2]).toMatch(/^0x/);
    expect(store.find(([, net]) => net === 'Arbitrum One')![2]).toMatch(/^0x/);
  });
});

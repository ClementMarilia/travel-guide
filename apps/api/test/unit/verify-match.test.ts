import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractTimes,
  findPrice,
  findText,
  findTime,
  formatTime,
  pageText,
} from '../../src/planning/verify-match.js';

describe('pageText', () => {
  it('drops scripts, styles and tags and decodes entities', () => {
    const text = pageText(
      '<style>.a{color:red}</style><script>var price = 999;</script><p>Entrada:&nbsp;15&euro; &amp; mais</p><noscript>x</noscript>',
    );

    assert.equal(text, 'Entrada: 15€ & mais');
  });

  it('keeps JSON-LD, where prices and opening hours often live', () => {
    const text = pageText(
      '<script type="application/ld+json">{"openingHours":"Mo-Su 09:00-21:00","price":"15"}</script><p>texto</p>',
    );

    assert.match(text, /09:00-21:00/);
  });

  it('decodes numeric entities', () => {
    assert.equal(pageText('<p>&#8364;15 e &#x24;20</p>'), '€15 e $20');
  });
});

describe('findPrice', () => {
  it('finds common ways of writing a price', () => {
    for (const written of ['120,00 €', '120.00 EUR', '€120', 'EUR 120', '120 euros', 'a partir de 120 €']) {
      assert.ok(findPrice(`Diária ${written} por noite`, 120, 'EUR'), `should find "${written}"`);
    }
  });

  it('understands thousands separators and decimals', () => {
    assert.ok(findPrice('Hotel 1.234,50 EUR', 1234.5, 'EUR'));
    assert.ok(findPrice('Hotel 1,234.50 EUR', 1234.5, 'EUR'));
    assert.ok(findPrice('Passe 6,80 € por dia', 6.8, 'EUR'));
    assert.ok(findPrice('Passe 1.234 EUR', 1234, 'EUR'));
  });

  it('does not confuse a different amount', () => {
    assert.equal(findPrice('Ingresso 15 EUR', 16, 'EUR'), null);
    assert.equal(findPrice('Ingresso 150 EUR', 15, 'EUR'), null);
    assert.equal(findPrice('Ingresso 15,5 EUR', 15, 'EUR'), null);
  });

  it('requires the currency to be next to the number', () => {
    assert.equal(findPrice('Ano de 2024, aberto em 15 de maio', 15, 'EUR'), null);
    assert.equal(findPrice('Ingresso 15 USD', 15, 'EUR'), null);
    assert.ok(findPrice('Ticket $15', 15, 'USD'));
    assert.ok(findPrice('Ingresso R$ 15,00', 15, 'BRL'));
  });

  it('returns an excerpt around the match that does not start mid-word', () => {
    const excerpt = findPrice(`${'palavra '.repeat(20)}Ingresso adulto: 15 EUR ${'outra '.repeat(20)}`, 15, 'EUR');

    assert.ok(excerpt?.includes('15 EUR'));
    assert.ok(!/^\S*ravra/.test(excerpt ?? ''));
  });
});

describe('times', () => {
  it('extracts times written in different ways', () => {
    assert.deepEqual(extractTimes('abre às 9h e fecha às 21h; sábado 09:30').map(formatTime), ['09:00', '09:30', '21:00']);
    assert.deepEqual(extractTimes('das 10h30 às 18h').map(formatTime), ['10:30', '18:00']);
  });

  it('ignores text with no clock time', () => {
    assert.deepEqual(extractTimes('fecha em feriados'), []);
    assert.deepEqual(extractTimes('em 2024 custou 15 euros'), []);
  });

  it('finds a time on the page in several formats', () => {
    for (const written of ['9h', '09h', '9:00', '09:00', '9h00', '9.00', '9 AM', '9am']) {
      assert.ok(findTime(`Aberto das ${written} ao fim da tarde`, 9 * 60), `should find "${written}"`);
    }
    assert.ok(findTime('Fecha às 21h', 21 * 60));
    assert.ok(findTime('Closes at 9 pm', 21 * 60));
  });

  it('does not match a time inside another number', () => {
    assert.equal(findTime('Abre às 19h', 9 * 60), null);
    assert.equal(findTime('Abre às 9h30', 9 * 60), null);
    assert.equal(findTime('Abre às 09:30', 9 * 60), null);
    assert.equal(findTime('Abre às 10h', 9 * 60), null);
  });
});

describe('findText', () => {
  it('matches ignoring case and returns null when absent', () => {
    assert.ok(findText('Voo TP 123 partida 10:35', 'tp 123'));
    assert.equal(findText('Voo TP 123', 'TP 999'), null);
  });
});

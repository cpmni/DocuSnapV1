#!/usr/bin/env python3
"""
tests/test_fixed_supplier_immune.py
-----------------------------------
Guards ExtractionEngine._doctype_fixed_supplier — the helper that makes a doc
type's FIXED Supplier Name immune to the logo fallback.

A doc type whose Supplier Name is an admin-fixed template field has a
deterministic supplier, so when a template MISS leaves supplier_name unresolved
the engine seeds the doc-type's fixed value (and skips the logo guess) instead of
letting a logo phash collision fill it (the "City Office NI on a Print Tracker
doc" bug). Returns None whenever there's no unambiguous fixed value, so the logo
fallback path stays byte-identical for every other doc type.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine

f = ExtractionEngine._doctype_fixed_supplier


def _field(value=None, locked=0):
    return {'key': 'supplier_name', 'fixed_value': value, 'fixed_locked': locked}


def _tmpl(slug, *fields):
    return {'document_type_slug': slug, 'fields': list(fields)}


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return 0 if cond else 1


def main():
    fails = 0

    # Locked fixed value -> used, method template_fixed_locked.
    fails += check('locked fixed supplier returned',
                   f([_tmpl('print_tracker', _field('Print Tracker', locked=1))], 'print_tracker')
                   == {'value': 'Print Tracker', 'method': 'template_fixed_locked'})

    # Plain (unlocked) fixed value -> used, method template_fixed.
    fails += check('plain fixed supplier returned',
                   f([_tmpl('inv', _field('Acme Ltd', locked=0))], 'inv')
                   == {'value': 'Acme Ltd', 'method': 'template_fixed'})

    # Locked wins over plain.
    fails += check('locked preferred over plain',
                   f([_tmpl('x', _field('Locked', locked=1)),
                      _tmpl('x', _field('Plain', locked=0))], 'x')
                   == {'value': 'Locked', 'method': 'template_fixed_locked'})

    # No fixed value anywhere -> None (logo fallback unchanged).
    fails += check('no fixed value -> None',
                   f([_tmpl('x', _field(None))], 'x') is None)

    # Slug mismatch -> None (only this doc type's fixed value applies).
    fails += check('slug mismatch -> None',
                   f([_tmpl('invoice', _field('A', locked=1))], 'print_tracker') is None)

    # Ambiguous locked values (two different) -> None, never guess.
    fails += check('ambiguous locked -> None',
                   f([_tmpl('x', _field('A', locked=1)),
                      _tmpl('x', _field('B', locked=1))], 'x') is None)

    # Same locked value across two templates -> still resolves (agreement).
    fails += check('agreeing locked across templates -> resolves',
                   f([_tmpl('x', _field('Same', locked=1)),
                      _tmpl('x', _field('Same', locked=1))], 'x')
                   == {'value': 'Same', 'method': 'template_fixed_locked'})

    # None / empty inputs -> None.
    fails += check('None templates -> None', f(None, 'x') is None)
    fails += check('empty slug -> None', f([_tmpl('x', _field('A', locked=1))], '') is None)

    # Whitespace-only fixed value is ignored.
    fails += check('blank fixed value ignored', f([_tmpl('x', _field('   ', locked=1))], 'x') is None)

    print('\nAll fixed-supplier-immune checks passed' if not fails
          else f'\n{fails} check(s) FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: people who want to understand what is happening in Italy (curious citizens, activists, students), opening the site mostly from a phone, during or after a mobilisation, to see where protests, strikes, sit-ins and blockades are, how serious they are, and how they evolve over hours and days. Secondary (served, not prioritised): people who travel or move goods, journalists and analysts.

## Product Purpose
ORACLE IT is a public, independent, geolocated information platform on protests, demonstrations, strikes, sit-ins and road/logistics blockades across Italy (all of Italy, early attention to the South). Success: in three seconds a visitor sees where things are happening and how serious they are, and trusts what they see because sources and checks are visible.

## Positioning
It distinguishes what is really happening, what is only announced and what is not confirmed, and always shows where each piece of information comes from. Events become public only above a credibility threshold computed from independent, weighted sources (official > agency > newspaper > promoter > user reports), explained on every event.

## Operating Context
- Italian only (i18n-ready). Italy only: no global or world view.
- Mobile first; desktop also used.
- Data model: mobilisation (overall initiative, may have no place) → event (place + time interval); sources, news items, user reports, evidence, timeline.
- Users can submit anonymous reports by placing a pin; reports alone can make an event visible only as a distinct "reported by N users" state.

## Capabilities and Constraints
- Map + synchronised list, filters (type, status, region, time), event sheet with sources, publication date vs event date, timeline, credibility explanation.
- Location precision is explicit: exact point, or only the comune (area). Road stretches only when a source documents them. No invented coordinates.
- Zero-cost stack: TypeScript, MapLibre GL with OpenFreeMap tiles (© OpenStreetMap), Cloudflare Workers, Neon/PostGIS.
- This repository is a throwaway prototype: all data is synthetic and must be labelled as such.

## Brand Commitments
- Name: ORACLE IT. Must not call itself a newspaper ("giornale", "testata").
- Tone: neutral, factual, attributed ("secondo …"). Must not look militant, institutional/bureaucratic, or like a traffic app.
- Owner's reference: the intelligence/operations-room feel of open-source "God's Eye View" projects and Flightradar, but on a real, detailed map. Owner wants a "wow" first impression.

## Evidence on Hand
No real events, sources or users yet. All prototype content is synthetic; real outlet or agency names must not be attached to invented news.

## Product Principles
1. Show the source before the claim.
2. Distinguish happening, announced and unconfirmed at a glance, never by colour alone.
3. Precision is honest: show only as much location detail as the evidence supports.
4. Events and infrastructure, never people: no tracking or profiling of individuals.
5. Clarity in three seconds beats density.

## Accessibility & Inclusion
States conveyed by shape and text as well as colour; keyboard navigable; list view as a full alternative to the map; contrast AA; respects reduced motion.

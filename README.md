# Planning - gestion de rdv

## Installation
pip install -r requirements.txt

## Lancement
python app.py

Ouvrir http://localhost:10000

Compte admin cree automatiquement au premier lancement : admin / admin123
(a changer immediatement une fois connecte, pas d'ecran dedie -> passer par sqlite ou ajouter une route si besoin)

## Roles
- admin : cree/supprime des comptes editor/viewer, gere les rdv
- editor : gere les rdv (creer/modifier/supprimer)
- viewer : lecture seule

## Utilisation agenda
- Vue semaine, navigation prec/suiv
- Clic sur un rdv -> details / modification
- Double-clic sur une case vide -> creation rapide (admin/editor)
- Bouton "+ Nouveau RDV" -> creation

## Structure
app.py            -> routes + logique + init DB (sqlite, planning.db cree au lancement)
templates/         -> HTML (Jinja2)
static/            -> CSS + JS (fetch API, pas de framework JS)

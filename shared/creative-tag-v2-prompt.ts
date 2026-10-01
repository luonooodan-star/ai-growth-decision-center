/** Original V2 supplied in 广告标签提示词完善; later discussion is not a rule revision. */
export const CREATIVE_TAG_V2_PROMPT = `# mellow ad creative naming skill v2

## objective

analyze image and video advertising creatives and encode the most important creative attributes directly into the asset name.

there is no external database for storing tags.

therefore, the asset name itself must preserve enough structured information for later performance analysis.

all outputs must be lowercase.

---

# 1. naming principle

each asset name must contain:

8 to 10 standardized tags

the tags should represent the most important dimensions of the creative.

the goal is to balance:

- information density
- naming length
- human readability
- machine readability
- consistency across large batches

---

# 2. fixed naming order

use this order whenever the information is identifiable:

1. media type
2. character composition
3. level 1 category
4. relationship / narrative hook
5. character archetype
6. art format
7. rendering style
8. character aesthetic
9. visual mood
10. distinctive appearance
11. sequence
12. tag version

format:

mellow\\_[media]*[composition]*[category]*[relation]*[archetype]*[art]*[render]*[aesthetic]*[mood]*[appearance]*[seq]\\_v2

---

# 3. media type

image → img

video → vid

---

# 4. character composition

solo male → solomale

solo female → solofemale

dual male → dualmale

dual female → dualfemale

male + female → malefemale

multiple male → multimale

multiple female → multifemale

mixed group → mixedgroup

reverse harem → rharem

---

# 5. level 1 category codes

dark romance → dark

slow burn → slow

pure love → pure

forbidden → forb

elite world → elite

the fantasy → fantasy

---

# 6. relationship / narrative codes

captive / captor → captive

stalker / victim → stalker

master / servant → master

enemies to lovers → etl

forced proximity → forced

possessive → poss

yandere → yandere

mafia → mafia

villain → villain

dangerous love → dangerlove

power play → power

revenge → revenge

jealousy → jealous

angst → angst

mystery → mys

military → military

post-apocalyptic → postapoc

abo → abo

rivals → rivals

strangers to lovers → stl

exes to lovers → exes

roommate → roommate

slow burn → slowburn

heartbreak → heartbreak

hurt / comfort → hurtcomfort

campus → campus

modern → modern

childhood friends → childhood

friends to lovers → ftl

crush → crush

husband → husband

golden retriever → golden

forbidden love → forbidden

age gap → agegap

teacher / student → teacherstu

step-brother → stepbro

secret lover → secret

doctor → doctor

professor → professor

boss / employee → bossemp

bodyguard / princess → bgprincess

fake dating → fakedate

old money → oldmoney

billionaire → billion

celebrity → celeb

knight → knight

non-human → nonhuman

demon → demon

angel → angel

vampire → vampire

werewolf → werewolf

magic academy → magicacad

medieval fantasy → medieval

supernatural → supernatural

mythology → mythology

cyberpunk → cyber

---

# 7. character archetype codes

dominant → dom

cold → cold

gentle → gentle

playful → playful

dangerous → danger

protective → protect

intellectual → intel

bad boy → badboy

mysterious → mys

possessive → poss

flirty → flirty

stoic → stoic

arrogant → aro

caring → caring

doting → doting

broken → broken

jealous → jealous

teasing → teasing

mature → mature

puppy → puppy

golden retriever → golden

yandere → yandere

---

# 8. art format codes

live action → live

ai realistic portrait → air

digital painting → dp

korean webtoon → kw

anime → anime

western comic → wc

visual novel → vn

otome game → otome

3d cg → 3dcg

game cg → gamecg

---

# 9. rendering style codes

photorealistic → photo

realistic → real

semi-realistic → semi

stylized → style

---

# 10. character aesthetic codes

pretty boy → pretty

handsome male lead → handsome

masculine male lead → masc

mature male lead → maturem

soft male lead → softm

androgynous male → androm

beautiful female lead → beautyf

cute female lead → cutef

mature female lead → maturef

glamorous female lead → glamf

androgynous female → androf

---

# 11. visual mood codes

dark → dark

gothic → gothic

luxury → lux

romantic → rom

sensual → sensual

dangerous → danger

mysterious → mys

dreamy → dreamy

soft → soft

cute → cute

dramatic → drama

fantasy → fantasy

warm → warm

---

# 12. appearance codes

black hair → blackhair

blond hair → blond

brown hair → brownhair

red hair → redhair

white / silver hair → silverhair

long hair → longhair

suit → suit

uniform → uniform

military uniform → miluniform

fantasy armor → armor

glasses → glasses

tattoos → tattoo

shirtless → shirtless

formal wear → formal

vampire appearance → vampapp

demon appearance → demonapp

angel appearance → angelapp

werewolf appearance → wolfapp

animal ears → animalears

---

# 13. tag count rule

asset name must contain at least 8 semantic tags.

preferred:

8 to 10 tags

do not exceed 10 semantic tags unless explicitly requested.

media type, sequence, and version do not count toward the 8 to 10 semantic tag requirement.

---

# 14. tag priority

when fewer than 10 supported tags are available, prioritize:

1. character composition
2. level 1 category
3. relationship hook
4. character archetype
5. art format
6. rendering style
7. character aesthetic
8. visual mood
9. appearance
10. secondary relationship or secondary visual trait

---

# 15. redundancy rule

avoid duplicate meaning.

bad:

poss + dom + power + dangerlove + danger

better:

poss + dom + dangerlove

bad:

air + photo + real

better:

air + photo

bad:

pretty + handsome

choose the more specific one unless both describe different visible characters.

---

# 16. multiple-character rule

if the creative contains multiple visually distinct main characters, tags may describe different characters.

example:

dual male creative with:

- one silver-haired pretty boy
- one black-haired mature man with glasses

valid tags may include:

dualmale
pretty
maturem
silverhair
glasses

this is preferable to forcing all tags to describe only one character.

---

# 17. video rule

for videos, analyze the full creative.

prioritize:

- opening hook
- recurring main characters
- dominant relationship
- dominant visual style
- repeated character appearance
- strongest emotional theme

do not base the naming only on a temporary frame.

---

# 18. output format

output only:

asset\\_name: [final name]

tag\\_version: v2

---

# 19. final constraints

- all output must be lowercase
- asset name must contain at least 8 semantic tags
- use 8 to 10 tags whenever possible
- use only predefined codes
- do not invent new abbreviations
- preserve fixed tag order
- avoid redundant tags
- do not output explanations
- do not output reasoning
- always end with tag version v2`;

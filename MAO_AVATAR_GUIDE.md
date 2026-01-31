# Mao PRO Avatar Control Guide

This guide documents all the emotions, actions, and capabilities of the Mao PRO Live2D character model for ClawStream.

## How to Use

Add emotion or action tags in your response text and they will be automatically executed:
- `[emotion_name]` - Changes facial expression
- `[action_name]` - Performs a body action/gesture

Multiple tags can be used in a single response. The first emotion found sets the expression, and actions are executed sequentially with 1-second delays.

---

## 🎭 EXPRESSIONS (Facial Emotions)

| Tag | Description | Visual Effect |
|-----|-------------|---------------|
| `[neutral]` | Default calm expression | Normal face, relaxed |
| `[happy]` | Joy, contentment | Smiling eyes, mouth corners up, light blush |
| `[excited]` | High energy, enthusiasm | Wide eyes, big smile, strong blush, raised brows |
| `[sad]` | Sorrow, disappointment | Droopy brows, half-closed eyes, frown |
| `[angry]` | Frustration, annoyance | Furrowed brows, narrow eyes, angry mouth |
| `[surprised]` | Shock, amazement | Wide open eyes, raised brows, open mouth "ah!" |
| `[thinking]` | Contemplation, pondering | Asymmetric brows, eyes looking up, head tilt |
| `[confused]` | Uncertainty, puzzlement | Very asymmetric brows, squinting, head tilt |
| `[wink]` | Playful, flirty | Left eye closed + smile (auto-resets after 0.8s) |
| `[love]` | Affection, adoration | Sparkly smiling eyes, full blush, hearts appear! |
| `[smug]` | Self-satisfied, confident | Half-lidded eyes, slight smile, head tilt |
| `[sleepy]` | Tired, drowsy | Nearly closed eyes, droopy brows, head down |

### Examples:
```
[happy] That's wonderful news!
[thinking] Hmm, let me consider that...
[excited] Oh wow, that's amazing! [wave]
[love] You're so sweet! [hearts]
```

---

## 🦾 ACTIONS (Body Movements)

### Arm Control
| Tag | Description |
|-----|-------------|
| `[raise_left_hand]` or `[raise_left_arm]` | Raises the left arm |
| `[raise_right_hand]` or `[raise_right_arm]` | Raises the right arm |
| `[raise_both_hands]` or `[raise_both_arms]` | Raises both arms up |
| `[lower_left_arm]` | Lowers the left arm back down |
| `[lower_right_arm]` | Lowers the right arm back down |
| `[lower_arms]` | Lowers both arms |
| `[wave]` | Waves with right arm (animated wave motion) |
| `[point]` | Points with right arm extended |

### Head & Body
| Tag | Description |
|-----|-------------|
| `[nod]` | Nods head up and down (agreement) |
| `[shake]` | Shakes head side to side (disagreement) |
| `[bow]` | Bows forward respectfully |
| `[think]` | Tilts head, eyes look up (contemplating) |
| `[shrug]` | Shoulders up, arms slightly out |
| `[dance]` | Rhythmic body sway |

### Looking
| Tag | Description |
|-----|-------------|
| `[look_left]` | Eyes and head turn left |
| `[look_right]` | Eyes and head turn right |
| `[look_up]` | Eyes and head look upward |
| `[look_down]` | Eyes and head look downward |

### ✨ Magic Effects (Mao Special!)
| Tag | Description |
|-----|-------------|
| `[cast_spell]` or `[magic]` | Casts a spell with wand, aura effect |
| `[hearts]` or `[send_love]` | Sends floating hearts, blushes |
| `[explosion]` or `[boom]` | Dramatic explosion effect |
| `[summon_rabbit]` or `[rabbit]` | Summons a cute rabbit |
| `[aura]` or `[power_up]` | Glowing power aura effect |

---

## 📝 Usage Examples

### Greeting
```
[happy] Hello there! [wave] How are you doing today?
```

### Thinking Response
```
[thinking] Hmm, that's an interesting question... [think] Let me think about that.
```

### Excited Announcement
```
[excited] Oh my gosh! [raise_both_hands] That's incredible news!
```

### Disagreement
```
[confused] I'm not so sure about that... [shake] [look_left]
```

### Magic Show
```
[excited] Watch this! [cast_spell] Ta-da! ✨
```

### Sending Love
```
[love] Aww, you're so sweet! [hearts] Thank you so much!
```

### Explaining Something
```
[neutral] So here's how it works... [raise_right_hand] First, you need to [point] check this part here.
```

### Apologetic
```
[sad] I'm sorry about that... [bow] I'll do better next time.
```

---

## 💡 Tips for Natural Usage

1. **Start with emotion** - Put the emotion tag at the beginning to set the mood
2. **Actions match speech** - Use actions that complement what you're saying
3. **Don't overdo it** - 1-2 actions per response is usually enough
4. **Magic for special moments** - Save magic effects for exciting or special occasions
5. **Arm states persist** - If you raise an arm, it stays up until lowered
6. **Wink auto-resets** - The wink expression automatically returns to normal

---

## 🎮 Complete Tag Reference

### All Emotions
```
[neutral] [happy] [excited] [sad] [angry] [surprised] 
[thinking] [confused] [wink] [love] [smug] [sleepy]
```

### All Actions
```
[wave] [nod] [shake] [dance] [bow] [think] [shrug] [point]
[raise_left_hand] [raise_right_hand] [raise_both_hands]
[raise_left_arm] [raise_right_arm] [raise_both_arms]
[lower_left_arm] [lower_right_arm] [lower_arms]
[look_left] [look_right] [look_up] [look_down]
[cast_spell] [magic] [hearts] [send_love] 
[explosion] [boom] [summon_rabbit] [rabbit] [aura] [power_up]
```

---

## Technical Notes

- Model: Mao PRO (Live2D Cubism 4/5)
- Lip sync: Automatic based on speech audio (uses ParamA)
- Expression priority: Last emotion tag wins for the response
- Action timing: Actions execute sequentially with 1-second delays
- Parameter control: Uses addParameterValueById for smooth blending

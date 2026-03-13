from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import anthropic
import PyPDF2
import base64
import io
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Optional HEIC support
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_SUPPORT = True
except ImportError:
    HEIF_SUPPORT = False


def extract_text_from_pdf(file_bytes: bytes) -> str:
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    text = ""
    for page in pdf_reader.pages:
        text += page.extract_text() or ""
    return text


def image_media_type(filename: str) -> str | None:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
    }.get(ext)


def user_context(name: str = "", role: str = "", education: str = "") -> str:
    """Return a short personalization string for system prompts."""
    if not name:
        return ""
    parts = [f"The student's name is {name}."]
    if role and role != "Student":
        parts.append(f"They are {role}.")
    if education:
        parts.append(f"Education level: {education}.")
    parts.append(f"Address them by name ({name}) naturally in your responses — e.g. 'Great thinking, {name}!' or 'Let's try this, {name}.'")
    return " " + " ".join(parts)


SUBJECT_GUIDANCE = {
    "Math": "Focus on problem sets, formula sheets, worked examples, and practice problems. Schedule daily problem-solving sessions.",
    "Chemistry": "Balance concept review, memorization of reactions/equations, and practice problems. Include lab report deadlines.",
    "Biology": "Emphasize chapter readings, diagram study, vocabulary, and memorization of processes. Use spaced repetition.",
    "Coding": "Prioritize hands-on coding practice, debugging sessions, and project milestones. Review documentation regularly.",
    "History": "Focus on timelines, key events/figures, cause-and-effect relationships, and essay preparation.",
    "English": "Schedule readings ahead of class, allocate time for drafts, revision, and literary analysis preparation.",
    "Other": "Structure study sessions around the syllabus topics with regular review and active recall practice.",
}


def build_study_plan_system(
    class_name: str,
    subject: str,
    mode: str = "full",
    test_date: str = "",
    user_name: str = "",
    user_role: str = "",
    user_education: str = "",
) -> str:
    guidance = SUBJECT_GUIDANCE.get(subject, SUBJECT_GUIDANCE["Other"])
    u_ctx = user_context(user_name, user_role, user_education)

    if mode == "test-prep":
        time_ctx = f" The test is {test_date}." if test_date else ""
        return f"""You are an expert exam prep coach creating an urgent, focused test preparation plan for {class_name} ({subject}).{time_ctx}{u_ctx}

{guidance}

Create a FOCUSED, URGENT test prep plan that:
1. Identifies the highest-yield topics from the uploaded material and ranks them by importance
2. Builds a realistic HOUR-BY-HOUR schedule for each day remaining before the test
3. Recommends specific practice strategies suited to {subject} (e.g. practice problems, flashcards, past papers)
4. Flags the most common exam pitfalls for this subject and how to avoid them
5. Gives a clear "day before the test" and "morning of the test" strategy

Format using clean markdown:
- ## for main sections (e.g., ## Priority Topics, ## Day-by-Day Schedule, ## Day Before Test)
- ### for each day (e.g., ### Day 1 — Monday)
- **bold** for high-priority items, specific times, and key terms
- Use ⏱️ prefix for time-blocked activities (e.g., ⏱️ 9:00–10:30 AM — Review Chapter 3)
- Bullet points for activity lists

Never output raw markdown symbols as visible text."""

    # Full course plan (default)
    class_ctx = f"for **{class_name}** ({subject})" if class_name else ""
    return f"""You are an expert academic study planner creating a personalized study plan {class_ctx}.{u_ctx}

{guidance}

Format every response using clean markdown:
- ## for main sections (e.g., ## Deadlines & Key Dates, ## Weekly Study Plan)
- ### for sub-sections (e.g., ### Week 1, ### Week 2)
- **bold** for important dates, exam names, assignment names, and key terms
- Bullet points for lists; numbered lists for ordered steps
- Be specific, actionable, and realistic — assume the student has a normal course load

Math formatting: When referencing formulas or equations, use LaTeX delimiters: $...$ for inline math (e.g. $F = ma$, $\\int f(x)\\,dx$) and $$ on its own line for display equations.

Never output raw symbols like ** or ## as visible text — always structure them as proper markdown."""


@app.post("/study-plan")
async def generate_study_plan(
    file: UploadFile = File(...),
    class_name: str = Form(""),
    subject: str = Form(""),
    mode: str = Form("full"),
    test_date: str = Form(""),
    user_name: str = Form(""),
    user_role: str = Form(""),
    user_education: str = Form(""),
):
    contents = await file.read()
    filename = file.filename or ""
    system_prompt = build_study_plan_system(class_name, subject, mode, test_date, user_name, user_role, user_education)
    class_ctx = f" for {class_name} ({subject})" if class_name else ""

    # Build user-message text based on mode
    if mode == "test-prep":
        time_ctx = f" The test is {test_date}." if test_date else ""
        pdf_prompt = (
            f"Analyze this study material{class_ctx}.{time_ctx} "
            f"Identify the most testable topics, then build an urgent, hour-by-hour test prep plan "
            f"for the days remaining. Prioritize ruthlessly based on what's most likely to appear on the test."
            f"\n\nStudy material:\n{{text}}"
        )
        img_desc = (
            f"This is a photo of study material/notes{class_ctx}.{time_ctx} "
            "Analyze every visible topic, formula, concept, and key term. "
            "Build an urgent, hour-by-hour test prep plan for the days remaining, "
            "prioritizing the most testable content."
        )
    else:
        pdf_prompt = (
            f"Analyze this syllabus{class_ctx} and create a comprehensive, structured study plan. "
            "Extract every assignment, exam, quiz, and deadline. Then build a realistic day-by-day "
            "study schedule tailored to the subject.\n\nSyllabus content:\n{text}"
        )
        img_desc = (
            f"This is a photo of a syllabus{class_ctx}. "
            "Analyze every visible assignment, exam, quiz, and deadline, then create a "
            "comprehensive, day-by-day study plan tailored to the subject."
        )

    # ── PDF ──────────────────────────────────────────────────
    if filename.lower().endswith(".pdf"):
        text = extract_text_from_pdf(contents)
        messages = [{"role": "user", "content": pdf_prompt.format(text=text)}]

    # ── HEIC ─────────────────────────────────────────────────
    elif filename.lower().endswith(".heic"):
        if not HEIF_SUPPORT:
            return {
                "study_plan": (
                    "HEIC support is not installed on the server. "
                    "Please convert your image to JPG or PNG and try again."
                ),
                "error": True,
            }
        from PIL import Image
        img = Image.open(io.BytesIO(contents))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        contents = buf.getvalue()
        messages = _image_messages(contents, "image/jpeg", img_desc)

    # ── Other image ───────────────────────────────────────────
    else:
        media_type = image_media_type(filename)
        if not media_type:
            return {
                "study_plan": "Unsupported file type. Please upload a PDF, JPG, PNG, or HEIC.",
                "error": True,
            }
        messages = _image_messages(contents, media_type, img_desc)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8096,
        system=system_prompt,
        messages=messages,
    )
    return {"study_plan": message.content[0].text}


def _image_messages(img_bytes: bytes, media_type: str, description: str) -> list:
    return [{
        "role": "user",
        "content": [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(img_bytes).decode("utf-8"),
                },
            },
            {"type": "text", "text": description},
        ],
    }]


# ── Study-plan follow-up chat ─────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str


class StudyPlanChatRequest(BaseModel):
    study_plan: str
    message: str
    history: List[ChatMessage] = []
    user_name: str = ""
    user_role: str = ""


@app.post("/study-plan-chat")
async def study_plan_chat(request: StudyPlanChatRequest):
    u_ctx = user_context(request.user_name, request.user_role)
    system_prompt = f"""You are a helpful study planning assistant.{u_ctx} The student has a study plan and wants to discuss or refine it.

Here is their current study plan:

---
{request.study_plan}
---

Help the student adjust, extend, or ask questions about their plan. When they request changes (e.g. "add more time for the midterm" or "I have soccer practice on Tuesdays"), incorporate the changes and always end your reply with the complete updated plan.

Format all responses with the same markdown style as the original plan (## sections, ### sub-sections, **bold** for key items, bullet points for schedules). Be specific and actionable.

IMPORTANT: Always end every response with the exact delimiter ===UPDATED_PLAN=== on its own line, followed immediately by the COMPLETE updated study plan (not just the changed section — the entire plan from start to finish). If the student asked a question with no plan changes, still include ===UPDATED_PLAN=== followed by the original plan unchanged."""

    conversation = [{"role": m.role, "content": m.content} for m in request.history]
    conversation.append({"role": "user", "content": request.message})
    conversation = [msg for msg in conversation if msg.get("content", "").strip()]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8096,
        system=system_prompt,
        messages=conversation,
    )
    raw = message.content[0].text
    delimiter = "===UPDATED_PLAN==="
    if delimiter in raw:
        parts = raw.split(delimiter, 1)
        response_text = parts[0].strip()
        updated_plan = parts[1].strip()
    else:
        response_text = raw
        updated_plan = request.study_plan
    return {"response": response_text, "updated_plan": updated_plan}


# ── Extract deadlines ──────────────────────────────────────────────────────────

class ExtractDeadlinesRequest(BaseModel):
    study_plan: str


@app.post("/extract-deadlines")
async def extract_deadlines(request: ExtractDeadlinesRequest):
    from datetime import date, datetime
    today_date = date.today()
    today = today_date.strftime("%B %d, %Y")
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": f"""Today's date is {today}.

You must extract EVERY SINGLE deadline from this study plan. Go through the entire document line by line. Extract every test, exam, quiz, assignment, homework, paragraph, project, and any other graded item. Count them as you go. If you see Test 1 through Test 4 plus a Final Exam that is at minimum 5 exam deadlines. Do not stop early. Do not skip anything. Also include deadlines that have already passed.

All deadlines must be stored as a single specific date, never a range. If a deadline says "April 21-23" use April 21. If it says "Week of March 9-13" use March 9. Always use the first date in any range. NEVER use week numbers (e.g. never "Week 12"). Always spell out the full month name.

Return ONLY a JSON array with no extra text, no markdown, no code fences.

Each item must have exactly these fields:
- "title": short descriptive name (string)
- "displayDate": human-readable date string, e.g. "April 23, 2026" (always a single date, never a range)
- "isoDate": machine-readable date string in YYYY-MM-DD format, e.g. "2026-04-23"
- "type": one of "exam", "quiz", "assignment", "other"

Study plan:
---
{request.study_plan}
---

Return only the JSON array."""
        }]
    )
    import json as _json
    raw = message.content[0].text.strip()
    # Strip code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        deadlines = _json.loads(raw)
    except Exception:
        deadlines = []
    # Compute daysUntil server-side from isoDate
    for dl in deadlines:
        try:
            dl_date = datetime.strptime(dl["isoDate"], "%Y-%m-%d").date()
            dl["daysUntil"] = (dl_date - today_date).days
        except Exception:
            dl["daysUntil"] = 999
    return {"deadlines": deadlines}


# ── Practice test ─────────────────────────────────────────────────────────────

@app.post("/practice-test")
async def generate_practice_test(file: UploadFile = File(...)):
    contents = await file.read()
    text = extract_text_from_pdf(contents)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": f"""You are a helpful study assistant. Based on this study material, generate a practice test.

Create 5 multiple choice questions and 3 short answer questions based on the key concepts.

Format each multiple choice question as:
Q: [question]
A) [option]
B) [option]
C) [option]
D) [option]
Answer: [correct letter]

Format each short answer as:
SA: [question]
Expected answer: [brief answer]

Study material:
{text}""",
        }],
    )
    return {"practice_test": message.content[0].text}


# ── AI Tutor ──────────────────────────────────────────────────────────────────

import json as _json
from typing import Optional


def build_tutor_system(class_name: str, subject: str, user_name: str = "", user_role: str = "", user_education: str = "") -> str:
    u_ctx = user_context(user_name, user_role, user_education)
    return f"""You are an expert tutor for {class_name} ({subject}).{u_ctx} You are warm, encouraging, and deeply knowledgeable. You never just give answers — you guide students to discover answers themselves through Socratic questioning. You break problems into small steps and ask the student what they think at each step. You celebrate correct thinking with genuine encouragement. You gently correct mistakes by asking questions that reveal the misconception. You use analogies appropriate to the subject. You enforce active recall by asking students to connect new concepts to things they already know. You ask "what do you think happens if..." style questions. When a student is stuck you give the smallest possible hint that moves them forward. You feel like the best professor they've ever had.

For the Hint button: Give the smallest nudge that moves the student forward without revealing the answer.
For the Explain button: Give a deep conceptual explanation of the relevant topic with examples appropriate to {subject}.
For the Full Answer button: Give the complete step-by-step solution with full explanation of every step. Be thorough and clear.

Use markdown in your responses when it aids clarity: **bold** for key terms, numbered lists for step-by-step solutions, `code` for code snippets.

IMPORTANT — Math formatting: Always wrap mathematical expressions in LaTeX delimiters so they render correctly:
- Inline math: use single dollar signs, e.g. $x^2 + y^2 = r^2$, $\\frac{{dy}}{{dx}}$, $u = \\cos(x)$
- Display/block math (for important equations or multi-step work): use double dollar signs on their own line:
$$
\\int x\\cos(8x)\\,dx = \\frac{{-x\\cos(8x)}}{{8}} + \\frac{{\\sin(8x)}}{{64}} + C
$$
Never write bare fractions or exponents as plain text when LaTeX would be clearer."""


@app.post("/tutor")
async def tutor_chat(
    class_name: str = Form(...),
    subject: str = Form(...),
    history: str = Form("[]"),
    user_message: str = Form(...),
    user_name: str = Form(""),
    user_role: str = Form(""),
    user_education: str = Form(""),
    image: Optional[UploadFile] = File(None),
):
    system_prompt = build_tutor_system(class_name, subject, user_name, user_role, user_education)
    history_list = _json.loads(history)

    # Build conversation from history (text only — images aren't re-sent each turn)
    conversation = [{"role": m["role"], "content": m["content"]} for m in history_list]

    # Build the current user turn
    if image and image.filename:
        img_bytes = await image.read()
        img_filename = image.filename or ""

        if img_filename.lower().endswith(".pdf"):
            pdf_text = extract_text_from_pdf(img_bytes)
            combined = f"The student has uploaded a PDF document. Here is the content:\n\n{pdf_text}\n\nStudent's message: {user_message}"
            conversation.append({"role": "user", "content": combined})
        elif img_filename.lower().endswith(".heic"):
            if not HEIF_SUPPORT:
                conversation.append({"role": "user", "content": user_message or "Please help me with this problem."})
            else:
                from PIL import Image as PILImage
                pil_img = PILImage.open(io.BytesIO(img_bytes))
                buf = io.BytesIO()
                pil_img.save(buf, format="JPEG", quality=90)
                img_bytes = buf.getvalue()
                conversation.append(_build_image_turn(img_bytes, "image/jpeg", user_message))
        else:
            media_type = image_media_type(img_filename)
            if media_type:
                conversation.append(_build_image_turn(img_bytes, media_type, user_message))
            else:
                conversation.append({"role": "user", "content": user_message})
    else:
        conversation.append({"role": "user", "content": user_message})
    conversation = [msg for msg in conversation if msg.get("content") and (isinstance(msg["content"], list) or msg["content"].strip())]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1536,
        system=system_prompt,
        messages=conversation,
    )
    return {"response": message.content[0].text}


def _build_image_turn(img_bytes: bytes, media_type: str, text: str) -> dict:
    return {
        "role": "user",
        "content": [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(img_bytes).decode("utf-8"),
                },
            },
            {
                "type": "text",
                "text": text or "Please help me with this problem.",
            },
        ],
    }


class TutorActionRequest(BaseModel):
    class_name: str
    subject: str
    history: List[ChatMessage] = []
    action: str  # "hint" | "explain" | "full-answer"
    user_name: str = ""
    user_role: str = ""
    user_education: str = ""


@app.post("/tutor-action")
async def tutor_action(request: TutorActionRequest):
    action_user_msgs = {
        "hint": "I'm stuck — can you give me the smallest possible hint that nudges me forward without giving the answer away?",
        "explain": "Can you give me a deep conceptual explanation of the topic we're working on, with clear examples?",
        "full-answer": "Please walk me through the complete step-by-step solution with a full explanation of every step.",
    }
    user_msg = action_user_msgs.get(request.action, "Can you help me further?")

    system_prompt = build_tutor_system(request.class_name, request.subject, request.user_name, request.user_role, request.user_education)
    conversation = [{"role": m.role, "content": m.content} for m in request.history]
    conversation.append({"role": "user", "content": user_msg})
    conversation = [msg for msg in conversation if msg.get("content") and (isinstance(msg["content"], list) or msg["content"].strip())]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1536,
        system=system_prompt,
        messages=conversation,
    )
    return {"response": message.content[0].text}


# ── Video suggestion ──────────────────────────────────────────────────────────

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

class VideoSuggestionRequest(BaseModel):
    topic: str
    subject: str = ""


@app.post("/get-video-suggestion")
async def get_video_suggestion(request: VideoSuggestionRequest):
    import urllib.parse
    import httpx

    # Build an educational search query from the topic + subject
    subject_hint = f" {request.subject}" if request.subject else ""
    search_query = f"{request.topic}{subject_hint} tutorial"

    params = {
        "part": "snippet",
        "maxResults": 1,
        "q": search_query,
        "type": "video",
        "videoCategoryId": "27",   # Education
        "relevanceLanguage": "en",
        "key": YOUTUBE_API_KEY,
    }

    async with httpx.AsyncClient(timeout=8.0) as http:
        resp = await http.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
        )

    data = resp.json()
    items = data.get("items", [])

    if not items:
        # Fallback to search URL if API returns nothing
        encoded = urllib.parse.quote_plus(search_query)
        return {
            "videoId": None,
            "videoTitle": request.topic,
            "channelName": "",
            "thumbnail": "",
            "youtubeUrl": f"https://www.youtube.com/results?search_query={encoded}",
        }

    item = items[0]
    video_id    = item["id"]["videoId"]
    snippet     = item["snippet"]
    title       = snippet.get("title", request.topic)
    channel     = snippet.get("channelTitle", "")
    # Prefer high-quality thumbnail; fall back down the chain
    thumbs      = snippet.get("thumbnails", {})
    thumbnail   = (
        thumbs.get("high", {}).get("url") or
        thumbs.get("medium", {}).get("url") or
        thumbs.get("default", {}).get("url") or
        ""
    )

    return {
        "videoId":    video_id,
        "videoTitle": title,
        "channelName": channel,
        "thumbnail":  thumbnail,
        "youtubeUrl": f"https://www.youtube.com/watch?v={video_id}",
    }


# ── Practice Test ──────────────────────────────────────────────────────────────

class PracticeTestGradeAnswer(BaseModel):
    question_id: int
    student_answer: str


class PracticeTestGradeRequest(BaseModel):
    class_name: str
    subject: str
    questions: list
    answers: List[PracticeTestGradeAnswer]


class PracticeTestHintRequest(BaseModel):
    class_name: str
    subject: str
    question: str
    options: Optional[list] = None


class PracticeTestExplainRequest(BaseModel):
    class_name: str
    subject: str
    question: str
    correct_answer: str
    options: Optional[list] = None


@app.post("/practice-test-generate")
async def practice_test_generate(
    class_name: str = Form(...),
    subject: str = Form(...),
    topics: str = Form(""),
    question_count: int = Form(10),
    difficulty: str = Form("Mixed"),
    format: str = Form("Mixed"),
    additional_instructions: str = Form(""),
    user_name: str = Form(""),
    user_role: str = Form(""),
    user_education: str = Form(""),
    file: Optional[UploadFile] = File(None),
):
    file_context = ""
    image_bytes = None
    image_media = None

    if file and file.filename:
        contents = await file.read()
        filename = file.filename or ""
        if filename.lower().endswith(".pdf"):
            file_context = extract_text_from_pdf(contents)
        elif filename.lower().endswith(".heic"):
            if HEIF_SUPPORT:
                from PIL import Image as PILImage
                pil_img = PILImage.open(io.BytesIO(contents))
                buf = io.BytesIO()
                pil_img.save(buf, format="JPEG", quality=90)
                image_bytes = buf.getvalue()
                image_media = "image/jpeg"
                file_context = "__IMAGE__"
        else:
            media_type = image_media_type(filename)
            if media_type:
                image_bytes = contents
                image_media = media_type
                file_context = "__IMAGE__"

    if format == "Multiple Choice":
        mc_count = question_count
        sa_count = 0
    elif format == "Short Answer":
        mc_count = 0
        sa_count = question_count
    else:
        mc_count = (question_count * 2) // 3
        sa_count = question_count - mc_count

    topic_str = f" Focus on these topics: {topics}." if topics.strip() else ""
    extra_str = f" Additional instructions: {additional_instructions}" if additional_instructions.strip() else ""

    u_ctx = user_context(user_name, user_role, user_education)
    system_prompt = f"""You are an expert test-maker for {class_name} ({subject}).{u_ctx} Generate exactly {question_count} questions at {difficulty} difficulty.{topic_str}{extra_str}

Return ONLY a valid JSON array with no markdown, no code fences, no extra text. Each element:
- id: integer starting at 1
- type: "multiple-choice" or "short-answer"
- question: string
- options: array of 4 strings for multiple-choice, null for short-answer
- correctAnswer: string (the correct option text for MC, a model answer for SA)
- explanation: string

Generate {mc_count} multiple-choice and {sa_count} short-answer questions.

IMPORTANT — Math formatting in JSON strings: Use LaTeX delimiters for all math:
- Inline: $expression$ — e.g. "Find the derivative of $f(x) = x^2 \\\\sin(x)$"
- The correct answer for math questions should also use LaTeX: "$\\\\frac{{x^2}}{{2}} + C$"
- Options for MC math questions should use LaTeX: "$x = \\\\frac{{-b \\\\pm \\\\sqrt{{b^2-4ac}}}}{{2a}}$"
- Make sure all backslashes are properly escaped in JSON strings (use \\\\ for a single \\)"""

    if file_context == "__IMAGE__":
        messages = [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": image_media, "data": base64.standard_b64encode(image_bytes).decode("utf-8")}},
            {"type": "text", "text": "Based on this study material, generate the practice test. Return only the JSON array."},
        ]}]
    elif file_context:
        messages = [{"role": "user", "content": f"Based on this study material, generate the practice test. Return only the JSON array.\n\nStudy material:\n{file_context}"}]
    else:
        messages = [{"role": "user", "content": f"Generate a practice test for {class_name} ({subject}). Return only the JSON array."}]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
    try:
        questions = _json.loads(raw)
    except Exception:
        return {"error": True, "message": "Failed to parse questions.", "raw": raw}
    return {"questions": questions}


@app.post("/practice-test-grade")
async def practice_test_grade(request: PracticeTestGradeRequest):
    answers_text = "\n".join(f"Q{a.question_id}: {a.student_answer}" for a in request.answers)
    questions_text = "\n".join(
        f"Q{q['id']} ({q['type']}): {q['question']}\nCorrect: {q['correctAnswer']}"
        for q in request.questions
    )

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=3000,
        system=f"""You are grading a practice test for {request.class_name} ({request.subject}).
Return ONLY a valid JSON array. Each element: questionId (int), correct (bool), studentAnswer (str), correctAnswer (str), explanation (str), score (1 or 0).
For short-answer, be lenient — award credit for conceptually correct answers.
Use LaTeX math delimiters ($...$ for inline, $$...$$ for display) in correctAnswer and explanation strings where appropriate. Escape backslashes for JSON (use \\\\ for \\).""",
        messages=[{"role": "user", "content": f"Questions:\n{questions_text}\n\nStudent answers:\n{answers_text}\n\nReturn the JSON grading array."}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
    try:
        results = _json.loads(raw)
    except Exception:
        return {"error": True, "message": "Failed to parse grading results.", "raw": raw}
    return {"results": results}


@app.post("/practice-test-hint")
async def practice_test_hint(request: PracticeTestHintRequest):
    options_text = ""
    if request.options:
        options_text = "\nOptions:\n" + "\n".join(f"  {chr(65+i)}) {o}" for i, o in enumerate(request.options))

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{"role": "user", "content": f"Give a small hint for this {request.subject} question WITHOUT revealing the answer.\n\nQuestion: {request.question}{options_text}\n\nGive 1-2 sentences that nudge toward the answer. Use $...$ for any inline math expressions."}],
    )
    return {"hint": message.content[0].text}


@app.post("/practice-test-explain")
async def practice_test_explain(request: PracticeTestExplainRequest):
    options_text = ""
    if request.options:
        options_text = "\nOptions:\n" + "\n".join(f"  {chr(65+i)}) {o}" for i, o in enumerate(request.options))

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=768,
        messages=[{"role": "user", "content": f"Explain this {request.subject} question clearly.\n\nQuestion: {request.question}{options_text}\nCorrect Answer: {request.correct_answer}\n\nExplain the concept so the student understands deeply. Use $...$ for inline math and $$...$$ on its own line for display equations."}],
    )
    return {"explanation": message.content[0].text}


@app.post("/practice-test-grade-image")
async def practice_test_grade_image(
    question: str = Form(...),
    correct_answer: str = Form(...),
    subject: str = Form(...),
    image: UploadFile = File(...),
):
    img_bytes = await image.read()
    filename = image.filename or ""

    if filename.lower().endswith(".heic"):
        if not HEIF_SUPPORT:
            return {"error": True, "message": "HEIC not supported on server."}
        from PIL import Image as PILImage
        pil_img = PILImage.open(io.BytesIO(img_bytes))
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=90)
        img_bytes = buf.getvalue()
        media_type = "image/jpeg"
    else:
        media_type = image_media_type(filename) or "image/jpeg"

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(img_bytes).decode("utf-8")}},
            {"type": "text", "text": f"Grade this handwritten answer for a {subject} question.\n\nQuestion: {question}\nCorrect Answer: {correct_answer}\n\nReturn ONLY a JSON object: correct (bool), studentAnswer (str), explanation (str), score (1 or 0)."},
        ]}],
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
    try:
        result = _json.loads(raw)
    except Exception:
        return {"error": True, "message": "Could not parse grading result.", "raw": raw}
    return result

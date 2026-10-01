import unittest

from app.manager import RelayManager, RelaySession


class RelaySessionTests(unittest.TestCase):
    def test_host_event_sequence_is_deduplicated(self):
        session = RelaySession(
            session_id="s1",
            created_at=0,
            expires_at=10_000_000_000,
            max_events=3,
            max_comments=3,
        )

        self.assertTrue(session.add_event(1, {"type": "a"}))
        self.assertFalse(session.add_event(1, {"type": "duplicate"}))
        self.assertTrue(session.add_event(2, {"type": "b"}))
        self.assertEqual([item["seq"] for item in session.events], [1, 2])

    def test_event_history_is_bounded(self):
        session = RelaySession(
            session_id="s1",
            created_at=0,
            expires_at=10_000_000_000,
            max_events=2,
            max_comments=3,
        )

        session.add_event(1, {"type": "a"})
        session.add_event(2, {"type": "b"})
        session.add_event(3, {"type": "c"})

        self.assertEqual([item["seq"] for item in session.events], [2, 3])
        self.assertNotIn(1, session.event_seqs)

    def test_comment_ack_history_is_bounded_and_deduplicated(self):
        session = RelaySession(
            session_id="s1",
            created_at=0,
            expires_at=10_000_000_000,
            max_events=3,
            max_comments=2,
        )

        session.remember_comment_ack("c1")
        session.remember_comment_ack("c1")
        session.remember_comment_ack("c2")
        session.remember_comment_ack("c3")

        self.assertEqual(list(session.acked_comments), ["c2", "c3"])
        self.assertNotIn("c1", session.acked_comment_ids)
        self.assertIn("c3", session.acked_comment_ids)


class RelayManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_can_be_created_and_revoked(self):
        manager = RelayManager()
        session = await manager.create_session(
            ttl_seconds=300,
            max_events=10,
            max_comments=10,
        )

        self.assertIsNotNone(await manager.get_session(session.session_id))
        removed = await manager.remove_session(session.session_id)
        self.assertIsNotNone(removed)
        self.assertIsNone(await manager.get_session(session.session_id))


if __name__ == "__main__":
    unittest.main()

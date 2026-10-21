import 'dotenv/config';
import { hash } from 'bcryptjs';
import dataSource from './data-source';
import { User, UserRole } from '../modules/users/entities/user.entity';

async function seedStudent(): Promise<void> {
  const registrationNo = '12345600';
  const password = '12345600';
  const fullName = 'Estudiante Demo';
  const degreeProgram = 'Ingeniería en Sistemas';

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    const existingUser = await users.findOne({ where: { registrationNo } });

    if (existingUser) {
      existingUser.role = UserRole.STUDENT;
      existingUser.passwordHash = await hash(password, 12);
      existingUser.fullName = fullName;
      existingUser.degreeProgram = degreeProgram;
      await users.save(existingUser);
      console.info(`Student ${registrationNo} updated successfully.`);
      return;
    }

    const user = users.create({
      role: UserRole.STUDENT,
      registrationNo,
      passwordHash: await hash(password, 12),
      fullName,
      degreeProgram,
    });
    await users.save(user);
    console.info(
      `Student created successfully with registration: ${registrationNo}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void seedStudent().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown error while seeding student';
  console.error(message);
  process.exitCode = 1;
});
